// Engagement chips for Gmail's Sent list: pure, keyed by normalised subject.
import type { EmailRow } from "./rows";
import type { Status } from "./types";

export interface Chip {
  text: string;
  status: Status;
}

/** Lowercase, collapse spaces, drop Re:/Fwd: prefixes, so a Sent row matches its record. */
export function normalizeSubject(subject: string): string {
  return subject.replace(/^(\s*(re|fwd?)\s*:)+/i, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function chipFor(row: EmailRow): Chip | null {
  switch (row.status) {
    case "replied": return { text: "Replied", status: "replied" };
    case "bounced": return { text: "Bounced", status: "bounced" };
    case "opened": return { text: row.openCount > 1 ? `Opened ${row.openCount}×` : "Opened", status: "opened" };
    case "opened_uncertain": return { text: "Opened (uncertain)", status: "opened_uncertain" };
    case "not_opened": return { text: "Not opened", status: "not_opened" };
    default: return null;
  }
}

export interface ChipEntry extends Chip {
  /** Lowercased recipient addresses of the email. */
  to: string[];
}

/** Chips per normalised subject, newest sent first (a subject can repeat across recipients). */
export function sentChips(rows: EmailRow[]): Record<string, ChipEntry[]> {
  const out: Record<string, ChipEntry[]> = {};
  const newestFirst = [...rows].sort((a, b) => Date.parse(b.email.sentAt) - Date.parse(a.email.sentAt));
  for (const row of newestFirst) {
    const key = normalizeSubject(row.email.subject);
    if (!key) continue;
    // Untracked emails still take a slot, so they can't lend their subject's chip to a sibling.
    (out[key] ??= []).push({ ...(chipFor(row) ?? { text: "", status: row.status }), to: row.email.to.map((a) => a.toLowerCase()) });
  }
  return out;
}

/**
 * The chip for one Sent-list row. `addresses` are the recipient addresses the row
 * shows. Without them, a chip is given only when the subject is unambiguous.
 */
export function pickChip(entries: ChipEntry[] | undefined, addresses: string[]): Chip | null {
  if (!entries?.length) return null;
  const wanted = addresses.map((a) => a.toLowerCase());
  const entry = wanted.length ? entries.find((e) => e.to.some((a) => wanted.includes(a))) : entries.length === 1 ? entries[0] : undefined;
  return entry?.text ? { text: entry.text, status: entry.status } : null;
}
