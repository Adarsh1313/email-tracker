// Pure view logic for the dashboard's Emails view: follow-up rule, filters,
// sorting, relative times, the detail timeline and Gmail links.
import type { EmailRow } from "./rows";
import { normaliseSubject } from "./tags";
import type { Classification, RoleType, Status, TrackedEmail } from "./types";

const DAY_MS = 86_400_000;

/**
 * Opened with no reply for `followUpDays` since the first open, or stale: sent
 * `followUpDays` ago and never opened. Replied, bounced and seed tests never qualify.
 */
export function needsFollowUp(row: EmailRow, now: number, followUpDays: number): boolean {
  if (row.email.seedTest) return false;
  const cutoff = now - followUpDays * DAY_MS;
  switch (row.status) {
    case "opened":
    case "opened_uncertain":
      return row.firstOpenAt !== null && Date.parse(row.firstOpenAt) <= cutoff;
    case "not_opened":
    case "untracked":
      return Date.parse(row.email.sentAt) <= cutoff;
    default:
      return false;
  }
}

export type StatusFilter = "all" | "follow_up" | "opened" | "replied" | "not_opened" | "bounced";

export interface EmailFilter {
  status: StatusFilter;
  /** "any" keeps every role; "" keeps emails with no role set. */
  role: RoleType | "any";
  /** Keep emails sent in the last N days; null keeps all. */
  rangeDays: number | null;
  search: string;
}

function matchesStatus(row: EmailRow, status: StatusFilter, now: number, followUpDays: number): boolean {
  switch (status) {
    case "all":
      return true;
    case "follow_up":
      return needsFollowUp(row, now, followUpDays);
    case "opened":
      return row.status === "opened" || row.status === "opened_uncertain";
    default:
      return row.status === status;
  }
}

function matchesSearch(row: EmailRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [...row.email.to, row.email.company, row.email.subject].some((field) => field.toLowerCase().includes(q));
}

export function filterRows(rows: EmailRow[], filter: EmailFilter, now: number, followUpDays: number): EmailRow[] {
  const since = filter.rangeDays === null ? -Infinity : now - filter.rangeDays * DAY_MS;
  return rows.filter(
    (row) =>
      matchesStatus(row, filter.status, now, followUpDays) &&
      (filter.role === "any" || row.email.role === filter.role) &&
      Date.parse(row.email.sentAt) >= since &&
      matchesSearch(row, filter.search),
  );
}

export type SortKey = "sent" | "first_open" | "last_activity";

const time = (iso: string | null) => (iso ? Date.parse(iso) : -Infinity);

/** Newest first. Emails with no open sort last under "first_open", by sent time. */
export function sortRows(rows: EmailRow[], key: SortKey): EmailRow[] {
  const primary = (r: EmailRow) =>
    key === "sent" ? time(r.email.sentAt) : key === "first_open" ? time(r.firstOpenAt) : time(r.lastActivityAt);
  return [...rows].sort((x, y) => primary(y) - primary(x) || time(y.email.sentAt) - time(x.email.sentAt));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "just now", "5m ago", "2h ago", "3d ago"; a date ("12 Sep") after 4 weeks, local time. */
export function relativeTime(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 28) return `${days}d ago`;
  const d = new Date(iso);
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? date : `${date} ${d.getFullYear()}`;
}

/** Compact exact local time under a relative time: "27 Oct, 2:05 pm" (year added if not this year). */
export function exactTimeShort(iso: string, now: number): string {
  const d = new Date(iso);
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : ` ${d.getFullYear()}`;
  const hour = d.getHours() % 12 || 12;
  const minute = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${hour}:${minute} ${d.getHours() < 12 ? "am" : "pm"}`;
}

export interface TimelineItem {
  ts: string;
  /** Which stamp to draw for this event. "self" is the mirror mark for my own views. */
  mark: Status | "self";
  label: string;
  /** Events that don't count towards the status (automated, own views). */
  faded: boolean;
  /** Set on open events, for the "That was me" action. */
  openId?: number;
  overridden?: boolean;
}

const OPEN_ITEM: Record<Classification, Pick<TimelineItem, "mark" | "label" | "faded">> = {
  human: { mark: "opened", label: "Opened", faded: false },
  uncertain: { mark: "opened_uncertain", label: "Opened (uncertain): may be an Apple Mail preload", faded: false },
  automated: { mark: "untracked", label: "Automated open (scanner or prefetch), not counted", faded: true },
  self: { mark: "self", label: "Your own view, ignored", faded: true },
};

const MARKED_AS_ME = { mark: "self", label: "Marked as you", faded: true } as const;

/** Who opened it, for the sub-line under Opened. The pixel is shared, so several recipients can't be told apart. */
export function openedBy(row: EmailRow): string | null {
  if (row.status !== "opened" && row.status !== "opened_uncertain") return null;
  const { to } = row.email;
  if (to.length === 0) return null;
  return to.length === 1 ? `by ${to[0]}` : `by one of ${to.length} recipients`;
}

/**
 * The sub-line under Replied: who replied (when several recipients could have)
 * and, for a tracked email with no recorded open, a note that tracking missed it.
 */
export function repliedLine(row: EmailRow): string | null {
  if (row.status !== "replied") return null;
  const parts: string[] = [];
  if (row.email.to.length > 1 && row.email.repliedBy) parts.push(`by ${row.email.repliedBy}`);
  if (row.email.tracked && row.openCount === 0) parts.push("open tracking missed");
  return parts.length ? parts.join(" · ") : null;
}

/** "3 times", shown only for repeat opens. */
export function openCountLabel(count: number): string | null {
  return count >= 2 ? `${count} times` : null;
}

/** The detail panel's events, oldest first. */
export function timelineOf(row: EmailRow): TimelineItem[] {
  const { email } = row;
  const to = email.to.join(", ");
  const items: TimelineItem[] = [
    email.tracked
      ? { ts: email.sentAt, mark: "not_opened", label: `Sent to ${to}`, faded: false }
      : { ts: email.sentAt, mark: "untracked", label: `Sent without tracking to ${to}`, faded: false },
    ...row.opens.map((o) => ({
      ts: o.ts,
      ...(o.overridden ? MARKED_AS_ME : OPEN_ITEM[o.classification]),
      openId: o.id,
      overridden: !!o.overridden,
    })),
  ];
  if (email.repliedAt) {
    const label = email.replyClient ? `Replied via ${email.replyClient}` : "Replied";
    items.push({ ts: email.repliedAt, mark: "replied", label, faded: false });
  }
  if (email.bouncedAt) items.push({ ts: email.bouncedAt, mark: "bounced", label: "Bounced", faded: false });
  return items.sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts));
}

const GMAIL = "https://mail.google.com/mail/u/0/";

/** The email's Gmail thread, or a Sent search for it until the thread is matched. */
export function gmailUrl(email: TrackedEmail): string {
  if (email.threadId) return `${GMAIL}#all/${email.threadId}`;
  const subject = normaliseSubject(email.subject.replace(/"/g, ""));
  return `${GMAIL}#search/${encodeURIComponent(`in:sent to:${email.to[0] ?? ""} subject:"${subject}"`)}`;
}
