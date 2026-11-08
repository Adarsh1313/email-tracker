import type { EmailRow } from "./rows";

/** Last open each email has notified me about, by email id. */
export type NotifyState = Record<string, string>;

export interface PendingNotification {
  emailId: string;
  /** The open this notification is about; store it as the new state for the email. */
  openTs: string;
  title: string;
  body: string;
}

/** An open must be this old before it notifies, so my own view can reclassify it first. */
const HOLD_MS = 10_000;
/** A re-open only notifies this long after the last notification. */
const REOPEN_GAP_MS = 3_600_000;

/**
 * Which emails deserve a desktop notification now: the first human open, and
 * re-opens more than an hour after the last notification. Replied, bounced,
 * untracked and seed-test emails stay quiet, as do opens from before
 * notifications were switched on (`since`).
 */
export function pendingNotifications(rows: EmailRow[], state: NotifyState, now: number, since: string): PendingNotification[] {
  const out: PendingNotification[] = [];
  for (const row of rows) {
    const { email } = row;
    if (!email.tracked || email.seedTest || row.status === "replied" || row.status === "bounced") continue;

    const settled = row.opens.filter(
      (o) => o.classification === "human" && Date.parse(o.ts) >= Date.parse(since) && now - Date.parse(o.ts) >= HOLD_MS,
    );
    const lastNotified = state[email.id];
    const fresh = lastNotified
      ? settled.filter((o) => Date.parse(o.ts) - Date.parse(lastNotified) > REOPEN_GAP_MS)
      : settled;
    const latest = fresh.at(-1);
    if (!latest) continue;

    const who = email.to.length === 1 ? email.to[0] : `one of ${email.to.length} recipients`;
    const subject = email.subject || "(no subject)";
    out.push({
      emailId: email.id,
      openTs: latest.ts,
      title: `${lastNotified ? "Opened again" : "Opened"}: ${subject}`,
      body: email.to.length ? `By ${who}` : "A recipient opened it",
    });
  }
  return out;
}
