// Gmail API sync (background): read-only access via chrome.identity. Matches
// sent emails to their threads, then checks those threads for replies and the
// inbox for bounce notices. Matching logic lives in core/gmail-sync.
import { backfillFrom, detectReply, matchBounce, matchThread, type GmailMessage } from "./core/gmail-sync";
import { prefillTags } from "./core/tags";
import type { TrackedEmail } from "./core/types";
import { db } from "./db";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const DAY_MS = 86_400_000;
/** Give up matching a record after this long (it was likely sent elsewhere or deleted). */
const MATCH_FOR_MS = 2 * DAY_MS;
/** Stop checking a thread for replies after this long. */
const REPLY_FOR_MS = 30 * DAY_MS;
const SEARCH_SLACK_S = 10 * 60;
const BOUNCES_SEEN_KEY = "bouncesSeen";

export interface GmailState {
  status: "disconnected" | "connected" | "reconnect";
  address?: string;
}

class AuthError extends Error {}

export async function getGmailState(): Promise<GmailState> {
  const stored = await chrome.storage.local.get("gmail");
  return (stored.gmail as GmailState | undefined) ?? { status: "disconnected" };
}

async function setGmailState(state: GmailState): Promise<void> {
  await chrome.storage.local.set({ gmail: state });
}

async function authToken(interactive: boolean): Promise<string> {
  try {
    const result = await chrome.identity.getAuthToken({ interactive });
    const token = typeof result === "string" ? result : result?.token;
    if (token) return token;
  } catch {
    // Not granted, revoked, or the user closed the consent window.
  }
  throw new AuthError("No Gmail access");
}

async function api<T>(path: string, retried = false): Promise<T> {
  const token = await authToken(false);
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 && !retried) {
    await chrome.identity.removeCachedAuthToken({ token });
    return api(path, true);
  }
  if (res.status === 401 || res.status === 403) throw new AuthError(`Gmail API ${res.status}`);
  if (!res.ok) throw new Error(`Gmail API ${res.status}`);
  return res.json();
}

async function search(q: string, max = 20): Promise<string[]> {
  const page = await api<{ messages?: { id: string }[] }>(`/messages?q=${encodeURIComponent(q)}&maxResults=${max}`);
  return (page.messages ?? []).map((m) => m.id);
}

const getMessage = (id: string) => api<GmailMessage>(`/messages/${id}?format=full`);

/** Asks for Gmail access (opens Google's consent window when needed). */
export async function connectGmail(): Promise<GmailState> {
  await authToken(true);
  const profile = await api<{ emailAddress: string }>("/profile");
  const state: GmailState = { status: "connected", address: profile.emailAddress };
  await setGmailState(state);
  return state;
}

async function matchSent(email: TrackedEmail, taken: Set<string>): Promise<TrackedEmail | null> {
  const at = Math.floor(Date.parse(email.sentAt) / 1000);
  const ids = await search(`in:sent after:${at - SEARCH_SLACK_S} before:${at + SEARCH_SLACK_S}`);
  const sent = await Promise.all(ids.filter((id) => !taken.has(id)).map(getMessage));
  const match = matchThread(email, sent, taken);
  if (!match) return null;
  taken.add(match.id);
  const patch = backfillFrom(email, match);
  const next: TrackedEmail = { ...email, ...patch, threadId: match.threadId, gmailMessageId: match.id };
  // A backfilled record had nothing to prefill from at send time.
  const tags = prefillTags(next.to, next.subject);
  if (patch.to && !next.company) next.company = tags.company;
  if (patch.subject && !next.variant) next.variant = tags.variant;
  return next;
}

async function checkReply(email: TrackedEmail, me: string): Promise<TrackedEmail | null> {
  const thread = await api<{ messages?: GmailMessage[] }>(`/threads/${email.threadId}?format=full`);
  const reply = detectReply(thread.messages ?? [], email.gmailMessageId ?? "", me);
  if (!reply) return null;
  return { ...email, repliedAt: reply.at, repliedBy: reply.from, ...(reply.client ? { replyClient: reply.client } : {}) };
}

async function checkBounces(emails: TrackedEmail[]): Promise<TrackedEmail[]> {
  const seen = new Set((await db.getMeta<string[]>(BOUNCES_SEEN_KEY)) ?? []);
  const ids = (await search("from:(mailer-daemon OR postmaster) newer_than:3d", 50)).filter((id) => !seen.has(id));
  const changed = new Map<string, TrackedEmail>();
  for (const id of ids) {
    const bounce = await getMessage(id);
    const pending = emails.map((e) => changed.get(e.id) ?? e);
    for (const emailId of matchBounce(bounce, pending)) {
      const email = pending.find((e) => e.id === emailId)!;
      changed.set(emailId, { ...email, bouncedAt: new Date(Number(bounce.internalDate)).toISOString() });
    }
    seen.add(id);
  }
  // Keep the seen list short: ids older than the 3-day search drop out naturally.
  await db.setMeta(BOUNCES_SEEN_KEY, [...seen].slice(-200));
  return [...changed.values()];
}

let running: Promise<number> | null = null;

/** Returns how many email records changed. Quietly does nothing until Gmail is connected. */
export function syncGmail(now = Date.now()): Promise<number> {
  running ??= (async () => {
    const state = await getGmailState();
    if (state.status !== "connected" || !state.address) return 0;
    try {
      const emails = await db.allEmails();
      const taken = new Set(emails.map((e) => e.gmailMessageId).filter((id): id is string => !!id));
      const updates = new Map<string, TrackedEmail>();

      for (const email of emails) {
        if (email.gmailMessageId || now - Date.parse(email.sentAt) > MATCH_FOR_MS) continue;
        const matched = await matchSent(email, taken);
        if (matched) updates.set(email.id, matched);
      }
      for (const original of emails) {
        const email = updates.get(original.id) ?? original;
        if (!email.threadId || !email.gmailMessageId || email.repliedAt || email.bouncedAt) continue;
        if (now - Date.parse(email.sentAt) > REPLY_FOR_MS) continue;
        const replied = await checkReply(email, state.address);
        if (replied) updates.set(email.id, replied);
      }
      for (const bounced of await checkBounces(emails.map((e) => updates.get(e.id) ?? e))) {
        updates.set(bounced.id, { ...(updates.get(bounced.id) ?? bounced), bouncedAt: bounced.bouncedAt });
      }

      for (const email of updates.values()) await db.putEmail(email);
      return updates.size;
    } catch (err) {
      if (err instanceof AuthError) {
        await setGmailState({ ...state, status: "reconnect" });
        return 0;
      }
      throw err;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
