import { classifyOpen, DEFAULT_RULES, type ClassifyRules } from "./classify";
import { deriveStatus } from "./status";
import type { ClassifiedOpen, OpenEvent, SelfView, Status, TrackedEmail } from "./types";

export interface EmailRow {
  email: TrackedEmail;
  status: Status;
  firstOpenAt: string | null;
  lastActivityAt: string;
  /** This email's opens, oldest first, each with its classification. */
  opens: ClassifiedOpen[];
  /** Opens that count towards the status (human and uncertain). */
  openCount: number;
}

function latest(times: (string | null | undefined)[]): string {
  return times.filter((t): t is string => !!t).reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

/**
 * Joins emails with their opens and returns one row per email, newest sent first.
 * `overrides` holds ids of opens I marked as mine; they're self whatever the rules say.
 */
export function buildRows(
  emails: TrackedEmail[],
  opens: OpenEvent[],
  selfViews: SelfView[],
  rules: ClassifyRules = DEFAULT_RULES,
  overrides: ReadonlySet<number> = new Set(),
): EmailRow[] {
  const byToken = new Map<string, OpenEvent[]>();
  for (const o of opens) {
    const list = byToken.get(o.token);
    if (list) list.push(o);
    else byToken.set(o.token, [o]);
  }

  return emails
    .map((email) => {
      const classified = (email.token ? byToken.get(email.token) ?? [] : [])
        .map((o): ClassifiedOpen =>
          overrides.has(o.id)
            ? { ...o, classification: "self", overridden: true }
            : { ...o, classification: classifyOpen(o, email, selfViews, rules) },
        )
        .sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts));
      const { status, firstOpenAt } = deriveStatus(email, classified);
      const counted = classified.filter((o) => o.classification === "human" || o.classification === "uncertain");
      return {
        email,
        status,
        firstOpenAt,
        lastActivityAt: latest([email.sentAt, counted.at(-1)?.ts, email.repliedAt, email.bouncedAt]),
        opens: classified,
        openCount: counted.length,
      };
    })
    .sort((x, y) => Date.parse(y.email.sentAt) - Date.parse(x.email.sentAt));
}
