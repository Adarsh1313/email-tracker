import type { Classification, OpenEvent, SelfView } from "./types";

// Tunable rules. The ASN and organisation lists are a starting point and
// should be checked against real events in week 1.
export interface ClassifyRules {
  /** Non-Gmail fetches this soon after sending are scanners. */
  scannerWindowMs: number;
  /** Fetches this close to a logged self-view are me. */
  selfViewWindowMs: number;
  /** Gmail proxy fetches this soon after sending may be my own phone: uncertain. */
  phoneWindowMs: number;
  humanUserAgents: RegExp[];
  automatedAsns: number[];
  automatedOrgs: RegExp[];
  uncertainAsns: number[];
  uncertainOrgs: RegExp[];
}

export const DEFAULT_RULES: ClassifyRules = {
  scannerWindowMs: 60_000,
  selfViewWindowMs: 90_000,
  phoneWindowMs: 600_000,
  // Gmail fetches images through its proxy only when the email is opened.
  humanUserAgents: [/GoogleImageProxy/i],
  automatedAsns: [
    16509, 14618, // Amazon AWS
    396982, // Google Cloud
    26211, 22843, // Proofpoint
    30031, // Mimecast
    15324, // Barracuda
    14061, // DigitalOcean
    16276, // OVH
    24940, // Hetzner
  ],
  automatedOrgs: [/amazon/i, /proofpoint/i, /mimecast/i, /barracuda/i, /digitalocean/i, /\bovh\b/i, /hetzner/i],
  // Apple Mail Privacy Protection preloads; Outlook.com may proxy images.
  uncertainAsns: [714, 6185, 8075],
  uncertainOrgs: [/apple/i, /microsoft/i],
};

export function classifyOpen(
  event: OpenEvent,
  email: { token: string | null; sentAt: string },
  selfViews: SelfView[],
  rules: ClassifyRules = DEFAULT_RULES,
): Classification {
  // Open times are server (Worker) time; sentAt and self-views are laptop time.
  // Use the server registration time as the send time, and shift self-views by
  // the measured clock offset, so drift on the laptop doesn't skew the windows.
  const ts = Date.parse(event.ts);
  const serverSentAt = event.registered_at ? Date.parse(event.registered_at) : Date.parse(email.sentAt);
  const clockOffset = Date.parse(email.sentAt) - serverSentAt;
  const sinceSend = ts - serverSentAt;

  // Decide by who fetched the image, not when: a fetch near one of my own
  // views is me; otherwise a Gmail proxy fetch is a real open, even straight
  // after sending. The scanner window only applies to other fetchers.
  if (
    selfViews.some(
      (v) => v.token === email.token && Math.abs(Date.parse(v.ts) - clockOffset - ts) <= rules.selfViewWindowMs,
    )
  ) {
    return "self";
  }

  const ua = event.user_agent ?? "";
  const org = event.as_org ?? "";
  if (rules.humanUserAgents.some((re) => re.test(ua))) {
    // My own phone views of the Sent copy look identical to a recipient's open,
    // and happen right after sending. Don't call those a confirmed open.
    return sinceSend < rules.phoneWindowMs ? "uncertain" : "human";
  }
  if (sinceSend < rules.scannerWindowMs) return "automated";
  if ((event.asn !== null && rules.automatedAsns.includes(event.asn)) || rules.automatedOrgs.some((re) => re.test(org))) {
    return "automated";
  }
  if ((event.asn !== null && rules.uncertainAsns.includes(event.asn)) || rules.uncertainOrgs.some((re) => re.test(org))) {
    return "uncertain";
  }
  return "human";
}
