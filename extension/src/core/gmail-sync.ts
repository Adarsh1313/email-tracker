// Pure Gmail API logic: match sent messages to email records, detect replies
// (and the client they came from), match bounces, backfill missing fields.
// Inputs are users.messages.get?format=full payloads.
import { normaliseSubject } from "./tags";
import type { TrackedEmail } from "./types";

export interface GmailPart {
  mimeType: string;
  headers?: { name: string; value: string }[];
  body?: { size: number; data?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  /** Epoch milliseconds, as a string. */
  internalDate: string;
  payload: GmailPart;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BOUNCE_SENDER = /mailer-daemon|postmaster/i;
const MATCH_WINDOW_MS = 10 * 60_000;
/** Records with no To/subject can only be matched by time, so the window is tighter. */
const BLANK_MATCH_WINDOW_MS = 5 * 60_000;
const BOUNCE_LOOKBACK_MS = 3 * 86_400_000;

/** Signatures that mail apps add to replies. Add more as real replies show them. */
const REPLY_CLIENTS: { name: string; pattern: RegExp }[] = [{ name: "Superhuman", pattern: /\bSent via Superhuman\b/i }];

export function header(msg: GmailMessage, name: string): string {
  const lower = name.toLowerCase();
  return msg.payload.headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? "";
}

export function addresses(value: string): string[] {
  return [...new Set((value.match(EMAIL_RE) ?? []).map((a) => a.toLowerCase()))];
}

function sentTime(msg: GmailMessage): number {
  return Number(msg.internalDate);
}

function decode(data: string): string {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Decoded text/plain and text/html parts, in tree order. */
function textParts(part: GmailPart): { mimeType: string; text: string }[] {
  if (part.parts?.length) return part.parts.flatMap(textParts);
  if ((part.mimeType === "text/plain" || part.mimeType === "text/html") && part.body?.data) {
    return [{ mimeType: part.mimeType, text: decode(part.body.data) }];
  }
  return [];
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** The message's text: plain parts as they are, HTML parts stripped of tags. */
export function messageText(msg: GmailMessage): string {
  return textParts(msg.payload)
    .map((p) => (p.mimeType === "text/html" ? htmlToText(p.text) : p.text))
    .join("\n");
}

/** The mail app a reply was sent from, read from the reply's own text (quotes ignored). */
export function replyClient(text: string): string | null {
  const own = text
    .split(/^\s*(On .+wrote:|-{2,}\s*Original Message\s*-{2,})\s*$/im)[0]
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
  return REPLY_CLIENTS.find((c) => c.pattern.test(own))?.name ?? null;
}

function clientOf(msg: GmailMessage): string | null {
  for (const p of textParts(msg.payload)) {
    // Gmail and most clients wrap quoted text in gmail_quote or <blockquote>.
    const text = p.mimeType === "text/html" ? htmlToText(p.text.split(/<div[^>]*gmail_quote|<blockquote/i)[0]) : p.text;
    const client = replyClient(text);
    if (client) return client;
  }
  return null;
}

function carriesToken(msg: GmailMessage, token: string | null): boolean {
  return !!token && textParts(msg.payload).some((p) => p.text.includes(token));
}

/**
 * The sent message for this email record: same recipients and subject, sent
 * within a few minutes. Records missing To or subject (a misread draft) match
 * by time alone, preferring the message that carries our pixel token.
 */
export function matchThread(email: TrackedEmail, sent: GmailMessage[], taken: Set<string>): GmailMessage | null {
  const at = Date.parse(email.sentAt);
  const blank = email.to.length === 0 || !email.subject.trim();
  const window = blank ? BLANK_MATCH_WINDOW_MS : MATCH_WINDOW_MS;
  const subject = normaliseSubject(email.subject).toLowerCase();
  const to = new Set(email.to.map((a) => a.toLowerCase()));

  const candidates = sent.filter((m) => {
    if (taken.has(m.id) || Math.abs(sentTime(m) - at) > window) return false;
    if (to.size && !addresses(`${header(m, "To")},${header(m, "Cc")}`).some((a) => to.has(a))) return false;
    if (subject && normaliseSubject(header(m, "Subject")).toLowerCase() !== subject) return false;
    return true;
  });
  candidates.sort(
    (x, y) =>
      Number(carriesToken(y, email.token)) - Number(carriesToken(x, email.token)) ||
      Math.abs(sentTime(x) - at) - Math.abs(sentTime(y) - at),
  );
  return candidates[0] ?? null;
}

/** Fields the record is missing, filled from its matched sent message. */
export function backfillFrom(email: TrackedEmail, msg: GmailMessage): Partial<Pick<TrackedEmail, "to" | "subject">> {
  const patch: Partial<Pick<TrackedEmail, "to" | "subject">> = {};
  if (email.to.length === 0) {
    const to = addresses(header(msg, "To"));
    if (to.length) patch.to = to;
  }
  if (!email.subject.trim() && header(msg, "Subject")) patch.subject = header(msg, "Subject");
  return patch;
}

/** The first message after our send from anyone but me (bounces excluded). */
/** "Priya Shah" from `Priya Shah <priya@acme.io>`, or the bare address. */
function senderName(msg: GmailMessage): string {
  const raw = header(msg, "From");
  const name = raw.replace(/<[^>]*>/, "").replace(/^["'\s]+|["'\s]+$/g, "");
  return name || (addresses(raw)[0] ?? raw);
}

export function detectReply(
  thread: GmailMessage[],
  sentMessageId: string,
  myAddress: string,
): { at: string; client: string | null; from: string } | null {
  const me = myAddress.toLowerCase();
  const ours = thread.find((m) => m.id === sentMessageId);
  const after = ours ? sentTime(ours) : -Infinity;
  const reply = thread
    .filter((m) => {
      const from = addresses(header(m, "From"));
      return sentTime(m) > after && from.length > 0 && !from.includes(me) && !from.some((a) => BOUNCE_SENDER.test(a));
    })
    .sort((x, y) => sentTime(x) - sentTime(y))[0];
  return reply
    ? { at: new Date(sentTime(reply)).toISOString(), client: clientOf(reply), from: senderName(reply) }
    : null;
}

/** Ids of the emails a bounce notice is about: the latest earlier send to each failed address. */
export function matchBounce(bounce: GmailMessage, emails: TrackedEmail[]): string[] {
  const at = sentTime(bounce);
  const failed = new Set([...addresses(header(bounce, "X-Failed-Recipients")), ...addresses(messageText(bounce))]);
  const ids = new Set<string>();
  for (const address of failed) {
    const latest = emails
      .filter((e) => {
        const sent = Date.parse(e.sentAt);
        return !e.bouncedAt && sent <= at && at - sent <= BOUNCE_LOOKBACK_MS && e.to.some((a) => a.toLowerCase() === address);
      })
      .sort((x, y) => Date.parse(y.sentAt) - Date.parse(x.sentAt))[0];
    if (latest) ids.add(latest.id);
  }
  return [...ids];
}
