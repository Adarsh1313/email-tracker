import { describe, expect, it } from "vitest";
import { deriveStatus } from "../../src/core/status";
import type { Classification, ClassifiedOpen, TrackedEmail } from "../../src/core/types";

const email: TrackedEmail = {
  id: "e1",
  token: "tok1234567890123456789",
  tracked: true,
  to: ["priya@acme.io"],
  subject: "Quick question about the platform role",
  sentAt: "2026-10-28T10:00:00.000Z",
  company: "Acme",
  role: "",
  variant: "Quick question about the platform role",
  seedTest: false,
};

let nextId = 1;
function open(classification: Classification, ts: string): ClassifiedOpen {
  return {
    id: nextId++,
    token: email.token!,
    ts,
    user_agent: null,
    asn: null,
    as_org: null,
    country: null,
    ip_hash: null,
    classification,
  };
}

describe("deriveStatus", () => {
  it("is not opened with no events", () => {
    expect(deriveStatus(email, [])).toEqual({ status: "not_opened", firstOpenAt: null });
  });

  it("ignores self and automated events", () => {
    const events = [open("self", "2026-10-28T10:02:00.000Z"), open("automated", "2026-10-28T10:00:30.000Z")];
    expect(deriveStatus(email, events).status).toBe("not_opened");
  });

  it("is opened (uncertain) with only uncertain events", () => {
    expect(deriveStatus(email, [open("uncertain", "2026-10-28T10:20:00.000Z")])).toEqual({
      status: "opened_uncertain",
      firstOpenAt: "2026-10-28T10:20:00.000Z",
    });
  });

  it("upgrades to opened on a human event, with first open from the earliest human event", () => {
    const events = [
      open("uncertain", "2026-10-28T10:20:00.000Z"),
      open("human", "2026-10-28T15:00:00.000Z"),
      open("human", "2026-10-28T12:00:00.000Z"),
    ];
    expect(deriveStatus(email, events)).toEqual({ status: "opened", firstOpenAt: "2026-10-28T12:00:00.000Z" });
  });

  it("is replied when a reply exists, even with no opens (images blocked)", () => {
    const replied = { ...email, repliedAt: "2026-10-29T09:00:00.000Z" };
    expect(deriveStatus(replied, [])).toEqual({ status: "replied", firstOpenAt: "2026-10-29T09:00:00.000Z" });
  });

  it("keeps the earlier pixel open as first open when replied", () => {
    const replied = { ...email, repliedAt: "2026-10-29T09:00:00.000Z" };
    expect(deriveStatus(replied, [open("human", "2026-10-28T12:00:00.000Z")]).firstOpenAt).toBe(
      "2026-10-28T12:00:00.000Z",
    );
  });

  it("puts bounced above everything", () => {
    const bounced = { ...email, repliedAt: "2026-10-29T09:00:00.000Z", bouncedAt: "2026-10-28T10:01:00.000Z" };
    expect(deriveStatus(bounced, [open("human", "2026-10-28T12:00:00.000Z")]).status).toBe("bounced");
  });

  it("is untracked when sent without a pixel and nothing stronger is known", () => {
    const untracked = { ...email, token: null, tracked: false };
    expect(deriveStatus(untracked, []).status).toBe("untracked");
    expect(deriveStatus({ ...untracked, repliedAt: "2026-10-29T09:00:00.000Z" }, []).status).toBe("replied");
  });
});
