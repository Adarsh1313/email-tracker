import type { ClassifiedOpen, Status, TrackedEmail } from "./types";

export interface DerivedStatus {
  status: Status;
  firstOpenAt: string | null;
}

function earliest(times: string[]): string | null {
  if (!times.length) return null;
  return times.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}

// Precedence: Bounced > Replied > Opened > Opened (uncertain) > Not opened.
// A reply counts as an open even when no pixel event exists.
export function deriveStatus(email: TrackedEmail, opens: ClassifiedOpen[]): DerivedStatus {
  const human = earliest(opens.filter((o) => o.classification === "human").map((o) => o.ts));
  const uncertain = earliest(opens.filter((o) => o.classification === "uncertain").map((o) => o.ts));
  const pixelOpen = human ?? uncertain;

  if (email.bouncedAt) return { status: "bounced", firstOpenAt: pixelOpen };
  if (email.repliedAt) return { status: "replied", firstOpenAt: earliest([pixelOpen, email.repliedAt].filter(Boolean) as string[]) };
  if (!email.tracked) return { status: "untracked", firstOpenAt: null };
  if (human) return { status: "opened", firstOpenAt: human };
  if (uncertain) return { status: "opened_uncertain", firstOpenAt: uncertain };
  return { status: "not_opened", firstOpenAt: null };
}
