// Shared domain types for the tracking core. No Chrome or DOM dependencies.

/** An open event as returned by the Tracker Worker's /api/events. */
export interface OpenEvent {
  id: number;
  token: string;
  ts: string;
  user_agent: string | null;
  asn: number | null;
  as_org: string | null;
  country: string | null;
  ip_hash: string | null;
  /** Server time the token was registered (≈ send time). Absent in old data. */
  registered_at?: string;
}

export type Classification = "human" | "automated" | "self" | "uncertain";

/** Me viewing my own copy of a tracked email in Gmail. */
export interface SelfView {
  token: string;
  ts: string;
}

export type RoleType = "" | "founder" | "hiring_manager" | "recruiter" | "other";

export type Status = "bounced" | "replied" | "opened" | "opened_uncertain" | "not_opened" | "untracked";

export interface TrackedEmail {
  id: string;
  /** Null when the email was sent without tracking. */
  token: string | null;
  tracked: boolean;
  to: string[];
  subject: string;
  sentAt: string;
  company: string;
  role: RoleType;
  variant: string;
  seedTest: boolean;
  /** Shared by the copies of one "Send separately" send. */
  groupId?: string;
  threadId?: string;
  /** The matched Gmail sent message (set by Gmail sync). */
  gmailMessageId?: string;
  repliedAt?: string;
  /** Who replied: display name, else address. */
  repliedBy?: string;
  /** Mail app the reply came from, e.g. "Superhuman", when its signature shows it. */
  replyClient?: string;
  bouncedAt?: string;
}

/** An open event after classification, stored locally. */
export interface ClassifiedOpen extends OpenEvent {
  classification: Classification;
  /** I marked this open as mine ("That was me"), overriding the rules. */
  overridden?: boolean;
}
