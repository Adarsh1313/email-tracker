// Separate-send copies share a groupId; the dashboard shows them as one row.
import type { EmailRow } from "./rows";
import type { Status } from "./types";

export interface EmailGroup {
  /** Newest copy first. */
  members: EmailRow[];
  /** Strongest member status; bounced only when every copy bounced. */
  status: Status;
  /** Recipients whose copy was opened or replied to. */
  engaged: string[];
}

const RANK: Record<Status, number> = { replied: 5, opened: 4, opened_uncertain: 3, not_opened: 2, untracked: 1, bounced: 0 };

function summarize(members: EmailRow[]): EmailGroup {
  const newestFirst = [...members].sort((a, b) => Date.parse(b.email.sentAt) - Date.parse(a.email.sentAt));
  const status = newestFirst.reduce<Status>((best, m) => (RANK[m.status] > RANK[best] ? m.status : best), newestFirst[0].status);
  const engaged = newestFirst
    .filter((m) => m.status === "opened" || m.status === "opened_uncertain" || m.status === "replied")
    .flatMap((m) => m.email.to);
  return { members: newestFirst, status, engaged };
}

/** Rows in input order; a group sits where its first-seen (newest) copy was. */
export function groupRows(rows: EmailRow[]): EmailGroup[] {
  const byGroup = new Map<string, EmailRow[]>();
  const order: (EmailRow[] )[] = [];
  for (const row of rows) {
    const id = row.email.groupId;
    if (!id) {
      order.push([row]);
      continue;
    }
    const existing = byGroup.get(id);
    if (existing) existing.push(row);
    else {
      const list = [row];
      byGroup.set(id, list);
      order.push(list);
    }
  }
  return order.map(summarize);
}
