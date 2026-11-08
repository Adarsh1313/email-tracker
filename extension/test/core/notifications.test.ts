import { describe, expect, it } from "vitest";
import { pendingNotifications, type NotifyState } from "../../src/core/notifications";
import type { EmailRow } from "../../src/core/rows";
import type { ClassifiedOpen, Classification, Status } from "../../src/core/types";

const NOW = Date.parse("2026-11-08T12:00:00.000Z");
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

let nextId = 1;
function open(msAgo: number, classification: Classification = "human"): ClassifiedOpen {
  return {
    id: nextId++,
    token: "tok1",
    ts: ago(msAgo),
    user_agent: null,
    asn: null,
    as_org: null,
    country: null,
    ip_hash: null,
    classification,
  };
}

function row(opens: ClassifiedOpen[], over: { status?: Status; to?: string[]; seedTest?: boolean; tracked?: boolean } = {}): EmailRow {
  const { status = "opened", to = ["priya@acme.io"], seedTest = false, tracked = true } = over;
  return {
    email: {
      id: "e1",
      token: "tok1",
      tracked,
      to,
      subject: "Platform role",
      sentAt: ago(60 * MIN),
      company: "Acme",
      role: "",
      variant: "",
      seedTest,
    },
    status,
    firstOpenAt: opens[0]?.ts ?? null,
    lastActivityAt: opens.at(-1)?.ts ?? ago(60 * MIN),
    opens,
    openCount: opens.filter((o) => o.classification === "human" || o.classification === "uncertain").length,
  };
}

const empty: NotifyState = {};
const SINCE = ago(24 * 60 * MIN);

describe("pendingNotifications", () => {
  it("notifies on the first human open once it has settled for 10 seconds", () => {
    const out = pendingNotifications([row([open(30_000)])], empty, NOW, SINCE);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ emailId: "e1", title: "Opened: Platform role" });
    expect(out[0].body).toContain("priya@acme.io");
  });

  it("holds back an open younger than 10 seconds so a self-view can cancel it", () => {
    expect(pendingNotifications([row([open(4_000)])], empty, NOW, SINCE)).toHaveLength(0);
  });

  it("ignores self, automated and uncertain opens", () => {
    const opens = [open(60_000, "self"), open(60_000, "automated"), open(60_000, "uncertain")];
    expect(pendingNotifications([row(opens)], empty, NOW, SINCE)).toHaveLength(0);
  });

  it("does not notify again for an open it already told me about", () => {
    const o = open(30_000);
    const state: NotifyState = { e1: o.ts };
    expect(pendingNotifications([row([o])], state, NOW, SINCE)).toHaveLength(0);
  });

  it("notifies about a re-open more than an hour after the last notification, not sooner", () => {
    const first = open(3 * 60 * MIN);
    const soon = open(2.5 * 60 * MIN); // 30 min after the first
    const later = open(30_000); // 2.5 h after the first
    const state: NotifyState = { e1: first.ts };
    expect(pendingNotifications([row([first, soon])], state, NOW, SINCE)).toHaveLength(0);
    const out = pendingNotifications([row([first, soon, later])], state, NOW, SINCE);
    expect(out).toHaveLength(1);
    expect(out[0].openTs).toBe(later.ts);
    expect(out[0].title).toBe("Opened again: Platform role");
  });

  it("only looks at opens after notifications were switched on", () => {
    const old = open(2 * 24 * 60 * MIN);
    expect(pendingNotifications([row([old])], empty, NOW, SINCE)).toHaveLength(0);
  });

  it("skips replied, bounced, untracked and seed-test emails", () => {
    const o = open(30_000);
    expect(pendingNotifications([row([o], { status: "replied" })], empty, NOW, SINCE)).toHaveLength(0);
    expect(pendingNotifications([row([o], { status: "bounced" })], empty, NOW, SINCE)).toHaveLength(0);
    expect(pendingNotifications([row([o], { tracked: false })], empty, NOW, SINCE)).toHaveLength(0);
    expect(pendingNotifications([row([o], { seedTest: true })], empty, NOW, SINCE)).toHaveLength(0);
  });

  it("says one of N recipients when several could have opened it", () => {
    const out = pendingNotifications([row([open(30_000)], { to: ["a@x.io", "b@x.io"] })], empty, NOW, SINCE);
    expect(out[0].body).toContain("one of 2 recipients");
  });
});
