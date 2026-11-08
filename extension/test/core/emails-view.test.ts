import { describe, expect, it } from "vitest";
import {
  exactTimeShort,
  filterRows,
  gmailUrl,
  needsFollowUp,
  openCountLabel,
  openedBy,
  repliedLine,
  relativeTime,
  sortRows,
  timelineOf,
  type EmailFilter,
} from "../../src/core/emails-view";
import type { EmailRow } from "../../src/core/rows";
import type { ClassifiedOpen, Classification, Status, TrackedEmail } from "../../src/core/types";

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function row(over: Partial<TrackedEmail> & { status?: Status; firstOpenAt?: string | null } = {}): EmailRow {
  const { status = "not_opened", firstOpenAt = null, ...email } = over;
  const e: TrackedEmail = {
    id: "id1",
    token: "tok1",
    tracked: true,
    to: ["priya@acme.io"],
    subject: "Quick question about the platform role",
    sentAt: ago(1),
    company: "Acme",
    role: "",
    variant: "Quick question about the platform role",
    seedTest: false,
    ...email,
  };
  return { email: e, status, firstOpenAt, lastActivityAt: firstOpenAt ?? e.sentAt, opens: [], openCount: 0 };
}

describe("openedBy", () => {
  it("names the one recipient of an opened email", () => {
    expect(openedBy(row({ status: "opened" }))).toBe("by priya@acme.io");
    expect(openedBy(row({ status: "opened_uncertain" }))).toBe("by priya@acme.io");
  });

  it("can't tell which of several recipients opened it", () => {
    expect(openedBy(row({ status: "opened", to: ["a@x.io", "b@x.io", "c@x.io"] }))).toBe("by one of 3 recipients");
  });

  it("says nothing when not opened, replied, or recipients are unknown", () => {
    expect(openedBy(row({ status: "not_opened" }))).toBeNull();
    expect(openedBy(row({ status: "replied" }))).toBeNull();
    expect(openedBy(row({ status: "opened", to: [] }))).toBeNull();
  });
});

describe("repliedLine", () => {
  it("says open tracking missed when a tracked email got a reply but no open", () => {
    expect(repliedLine(row({ status: "replied" }))).toBe("open tracking missed");
  });

  it("says nothing extra for a reply that was also opened", () => {
    expect(repliedLine({ ...row({ status: "replied" }), openCount: 2 })).toBeNull();
  });

  it("names who replied when there are several recipients", () => {
    const r = row({ status: "replied", to: ["a@x.io", "b@x.io"], repliedBy: "Priya" });
    expect(repliedLine({ ...r, openCount: 1 })).toBe("by Priya");
    expect(repliedLine(r)).toBe("by Priya · open tracking missed");
  });

  it("does not claim missed tracking for an untracked email, or for other statuses", () => {
    expect(repliedLine(row({ status: "replied", tracked: false, token: null }))).toBeNull();
    expect(repliedLine(row({ status: "opened" }))).toBeNull();
  });
});

describe("openCountLabel", () => {
  it("shows a count only for repeat opens", () => {
    expect(openCountLabel(0)).toBeNull();
    expect(openCountLabel(1)).toBeNull();
    expect(openCountLabel(2)).toBe("2 times");
    expect(openCountLabel(7)).toBe("7 times");
  });
});

describe("needsFollowUp (follow-up window of 3 days)", () => {
  it("flags an email opened more than N days ago with no reply", () => {
    expect(needsFollowUp(row({ sentAt: ago(5), status: "opened", firstOpenAt: ago(4) }), NOW, 3)).toBe(true);
    expect(needsFollowUp(row({ sentAt: ago(5), status: "opened_uncertain", firstOpenAt: ago(4) }), NOW, 3)).toBe(true);
  });

  it("waits N days after the first open, not after sending", () => {
    expect(needsFollowUp(row({ sentAt: ago(5), status: "opened", firstOpenAt: ago(1) }), NOW, 3)).toBe(false);
  });

  it("flags a stale email: sent more than N days ago, never opened, no reply", () => {
    expect(needsFollowUp(row({ sentAt: ago(4) }), NOW, 3)).toBe(true);
    expect(needsFollowUp(row({ sentAt: ago(4), tracked: false, token: null, status: "untracked" }), NOW, 3)).toBe(true);
    expect(needsFollowUp(row({ sentAt: ago(2) }), NOW, 3)).toBe(false);
  });

  it("never flags replied, bounced or seed-test emails", () => {
    expect(needsFollowUp(row({ sentAt: ago(9), status: "replied", firstOpenAt: ago(8) }), NOW, 3)).toBe(false);
    expect(needsFollowUp(row({ sentAt: ago(9), status: "bounced" }), NOW, 3)).toBe(false);
    expect(needsFollowUp(row({ sentAt: ago(9), seedTest: true }), NOW, 3)).toBe(false);
  });
});

describe("filterRows", () => {
  const all: EmailFilter = { status: "all", role: "any", rangeDays: null, search: "" };
  const opened = row({ id: "opened", sentAt: ago(5), status: "opened", firstOpenAt: ago(4), role: "founder" });
  const uncertain = row({ id: "uncertain", status: "opened_uncertain", firstOpenAt: ago(0.5) });
  const replied = row({ id: "replied", sentAt: ago(10), status: "replied", to: ["marcus@linear.app"], company: "Linear", role: "recruiter" });
  const fresh = row({ id: "fresh", sentAt: ago(0.2), subject: "Payments infra notes", to: ["dortiz@stripe.com"], company: "Stripe" });
  const bounced = row({ id: "bounced", sentAt: ago(40), status: "bounced" });
  const rows = [opened, uncertain, replied, fresh, bounced];
  const ids = (f: Partial<EmailFilter>) => filterRows(rows, { ...all, ...f }, NOW, 3).map((r) => r.email.id);

  it("keeps everything with the default filter", () => {
    expect(ids({})).toEqual(["opened", "uncertain", "replied", "fresh", "bounced"]);
  });

  it("filters by status, counting uncertain opens as opened", () => {
    expect(ids({ status: "opened" })).toEqual(["opened", "uncertain"]);
    expect(ids({ status: "replied" })).toEqual(["replied"]);
    expect(ids({ status: "not_opened" })).toEqual(["fresh"]);
    expect(ids({ status: "bounced" })).toEqual(["bounced"]);
    expect(ids({ status: "follow_up" })).toEqual(["opened"]);
  });

  it("filters by role, including emails with no role set", () => {
    expect(ids({ role: "recruiter" })).toEqual(["replied"]);
    expect(ids({ role: "" })).toEqual(["uncertain", "fresh", "bounced"]);
  });

  it("keeps only emails sent within the date range", () => {
    expect(ids({ rangeDays: 7 })).toEqual(["opened", "uncertain", "fresh"]);
  });

  it("searches recipient, company and subject, ignoring case and spaces around the query", () => {
    expect(ids({ search: "  LINEAR " })).toEqual(["replied"]);
    expect(ids({ search: "dortiz@" })).toEqual(["fresh"]);
    expect(ids({ search: "payments infra" })).toEqual(["fresh"]);
    expect(ids({ search: "nobody" })).toEqual([]);
  });

  it("combines filters", () => {
    expect(ids({ status: "opened", rangeDays: 1 })).toEqual(["uncertain"]);
  });
});

describe("sortRows", () => {
  const a = { ...row({ id: "a", sentAt: ago(3), status: "opened", firstOpenAt: ago(0.1) }), lastActivityAt: ago(0.1) };
  const b = { ...row({ id: "b", sentAt: ago(1) }), lastActivityAt: ago(1) };
  const c = { ...row({ id: "c", sentAt: ago(2), status: "replied", firstOpenAt: ago(1.5) }), lastActivityAt: ago(0.5) };
  const d = { ...row({ id: "d", sentAt: ago(4) }), lastActivityAt: ago(4) };
  const rows = [a, b, c, d];
  const ids = (key: Parameters<typeof sortRows>[1]) => sortRows(rows, key).map((r) => r.email.id);

  it("sorts by sent time, newest first", () => {
    expect(ids("sent")).toEqual(["b", "c", "a", "d"]);
  });

  it("sorts by first open, newest first, with unopened emails last by sent time", () => {
    expect(ids("first_open")).toEqual(["a", "c", "b", "d"]);
  });

  it("sorts by last activity, newest first", () => {
    expect(ids("last_activity")).toEqual(["a", "c", "b", "d"]);
  });

  it("does not reorder the input array", () => {
    sortRows(rows, "sent");
    expect(rows.map((r) => r.email.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("relativeTime", () => {
  const before = (ms: number) => new Date(NOW - ms).toISOString();

  it("reads recent times as minutes, hours and days ago", () => {
    expect(relativeTime(before(20_000), NOW)).toBe("just now");
    expect(relativeTime(before(5 * 60_000), NOW)).toBe("5m ago");
    expect(relativeTime(before(2 * 3_600_000), NOW)).toBe("2h ago");
    expect(relativeTime(before(3 * DAY), NOW)).toBe("3d ago");
  });

  it("treats a slightly future time (clock skew) as just now", () => {
    expect(relativeTime(new Date(NOW + 30_000).toISOString(), NOW)).toBe("just now");
  });

  it("shows a date once it is more than 4 weeks old", () => {
    expect(relativeTime("2026-09-12T09:00:00.000Z", NOW)).toBe("12 Sep");
    expect(relativeTime("2025-09-12T09:00:00.000Z", NOW)).toBe("12 Sep 2025");
  });
});

describe("exactTimeShort", () => {
  // Built from local-time parts so the test holds in any time zone.
  const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).toISOString();

  it("shows day, month and 12-hour clock time", () => {
    expect(exactTimeShort(local(2026, 9, 27, 14, 5), NOW)).toBe("27 Oct, 2:05 pm");
    expect(exactTimeShort(local(2026, 9, 27, 0, 30), NOW)).toBe("27 Oct, 12:30 am");
    expect(exactTimeShort(local(2026, 9, 27, 12, 0), NOW)).toBe("27 Oct, 12:00 pm");
  });

  it("adds the year when it isn't this year", () => {
    expect(exactTimeShort(local(2025, 8, 12, 9, 0), NOW)).toBe("12 Sep 2025, 9:00 am");
  });
});

describe("timelineOf", () => {
  const open = (id: number, ts: string, classification: Classification): ClassifiedOpen => ({
    id, token: "tok1", ts, user_agent: "Mozilla/5.0 (via ggpht.com GoogleImageProxy)", asn: 15169, as_org: "Google LLC", country: "US", ip_hash: "h", classification,
  });

  it("lists send, every open with its classification, reply and bounce, oldest first", () => {
    const r: EmailRow = {
      ...row({ sentAt: "2026-10-27T09:00:00.000Z", status: "replied", to: ["priya@acme.io", "ops@acme.io"], repliedAt: "2026-10-28T08:00:00.000Z" }),
      opens: [
        open(1, "2026-10-27T09:00:20.000Z", "automated"),
        open(2, "2026-10-27T09:02:00.000Z", "self"),
        open(3, "2026-10-27T15:00:00.000Z", "uncertain"),
        open(4, "2026-10-27T18:00:00.000Z", "human"),
      ],
    };
    expect(timelineOf(r)).toEqual([
      { ts: "2026-10-27T09:00:00.000Z", mark: "not_opened", label: "Sent to priya@acme.io, ops@acme.io", faded: false },
      { ts: "2026-10-27T09:00:20.000Z", mark: "untracked", label: "Automated open (scanner or prefetch), not counted", faded: true, openId: 1, overridden: false },
      { ts: "2026-10-27T09:02:00.000Z", mark: "self", label: "Your own view, ignored", faded: true, openId: 2, overridden: false },
      { ts: "2026-10-27T15:00:00.000Z", mark: "opened_uncertain", label: "Opened (uncertain): may be an Apple Mail preload", faded: false, openId: 3, overridden: false },
      { ts: "2026-10-27T18:00:00.000Z", mark: "opened", label: "Opened", faded: false, openId: 4, overridden: false },
      { ts: "2026-10-28T08:00:00.000Z", mark: "replied", label: "Replied", faded: false },
    ]);
  });

  it("names the reply client when known", () => {
    const r = row({ status: "replied", repliedAt: "2026-10-28T08:00:00.000Z", replyClient: "Superhuman" });
    expect(timelineOf(r).at(-1)?.label).toBe("Replied via Superhuman");
  });

  it("labels an open I marked as mine", () => {
    const r: EmailRow = { ...row(), opens: [{ ...open(9, "2026-10-28T09:00:00.000Z", "self"), overridden: true }] };
    expect(timelineOf(r)[1]).toEqual({ ts: "2026-10-28T09:00:00.000Z", mark: "self", label: "Marked as you", faded: true, openId: 9, overridden: true });
  });

  it("marks an untracked send and a bounce", () => {
    const r = row({ token: null, tracked: false, status: "bounced", sentAt: "2026-10-27T09:00:00.000Z", bouncedAt: "2026-10-27T09:01:00.000Z" });
    expect(timelineOf(r)).toEqual([
      { ts: "2026-10-27T09:00:00.000Z", mark: "untracked", label: "Sent without tracking to priya@acme.io", faded: false },
      { ts: "2026-10-27T09:01:00.000Z", mark: "bounced", label: "Bounced", faded: false },
    ]);
  });
});

describe("gmailUrl", () => {
  it("opens the matched thread directly", () => {
    expect(gmailUrl(row({ threadId: "18c2f0a9b7e4d123" }).email)).toBe("https://mail.google.com/mail/u/0/#all/18c2f0a9b7e4d123");
  });

  it("falls back to a Sent search by recipient and subject before the thread is matched", () => {
    const e = row({ to: ["priya@acme.io"], subject: 'Re: "Quick" question & more' }).email;
    expect(gmailUrl(e)).toBe(
      "https://mail.google.com/mail/u/0/#search/" + encodeURIComponent('in:sent to:priya@acme.io subject:"Quick question & more"'),
    );
  });
});
