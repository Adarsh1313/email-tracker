import { describe, expect, it } from "vitest";
import { buildRows } from "../../src/core/rows";
import type { OpenEvent, TrackedEmail } from "../../src/core/types";

const PROXY_UA = "Mozilla/5.0 (via ggpht.com GoogleImageProxy)";

function email(id: string, sentAt: string): TrackedEmail {
  return {
    id,
    token: id,
    tracked: true,
    to: [`${id}@acme.io`],
    subject: "Hi",
    sentAt,
    company: "Acme",
    role: "",
    variant: "Hi",
    seedTest: false,
  };
}

function open(id: number, token: string, ts: string): OpenEvent {
  return { id, token, ts, user_agent: PROXY_UA, asn: 15169, as_org: "Google LLC", country: "US", ip_hash: "h" };
}

describe("buildRows", () => {
  const a = email("tokenAAAAAAAAAAAAAAAAA", "2026-10-28T10:00:00.000Z");
  const b = email("tokenBBBBBBBBBBBBBBBBB", "2026-10-28T11:00:00.000Z");

  it("joins each email with its own classified opens and derived status, newest first", () => {
    const rows = buildRows([a, b], [open(1, a.token!, "2026-10-28T12:00:00.000Z")], []);
    expect(rows.map((r) => r.email.id)).toEqual([b.id, a.id]);
    expect(rows[1]).toMatchObject({ status: "opened", firstOpenAt: "2026-10-28T12:00:00.000Z" });
    expect(rows[1].opens[0].classification).toBe("human");
    expect(rows[0]).toMatchObject({ status: "not_opened", opens: [] });
  });

  it("reclassifies an open as self when the self-view arrives after it", () => {
    const opens = [open(1, a.token!, "2026-10-28T12:00:00.000Z")];
    const rows = buildRows([a], opens, [{ token: a.token!, ts: "2026-10-28T12:00:20.000Z" }]);
    expect(rows[0].status).toBe("not_opened");
    expect(rows[0].opens[0].classification).toBe("self");
  });

  it("reports last activity as the latest of send, counted open, reply and bounce", () => {
    const replied = { ...a, repliedAt: "2026-10-29T08:00:00.000Z" };
    const rows = buildRows([replied], [open(1, a.token!, "2026-10-28T12:00:00.000Z")], []);
    expect(rows[0].lastActivityAt).toBe("2026-10-29T08:00:00.000Z");
  });

  it("counts only opens that count towards the status (human and uncertain)", () => {
    const opens = [
      open(1, a.token!, "2026-10-28T10:00:30.000Z"),
      open(2, a.token!, "2026-10-28T12:00:00.000Z"),
      { ...open(3, a.token!, "2026-10-28T13:00:00.000Z"), user_agent: "Mozilla/5.0", asn: 714, as_org: "Apple Inc." },
      { ...open(4, a.token!, "2026-10-28T14:00:00.000Z"), user_agent: "Mozilla/5.0", asn: 16509, as_org: "Amazon" },
    ];
    const rows = buildRows([a], opens, [{ token: a.token!, ts: "2026-10-28T10:00:20.000Z" }]);
    expect(rows[0].opens.map((o) => o.classification)).toEqual(["self", "human", "uncertain", "automated"]);
    expect(rows[0].openCount).toBe(2);
  });

  it("applies 'That was me' overrides: the open becomes self and the status recomputes", () => {
    const opens = [open(1, a.token!, "2026-10-28T12:00:00.000Z"), open(2, a.token!, "2026-10-28T15:00:00.000Z")];
    const [one] = buildRows([a], opens, [], undefined, new Set([1]));
    expect(one.opens[0]).toMatchObject({ classification: "self", overridden: true });
    expect(one).toMatchObject({ status: "opened", firstOpenAt: "2026-10-28T15:00:00.000Z", openCount: 1 });

    const [both] = buildRows([a], opens, [], undefined, new Set([1, 2]));
    expect(both).toMatchObject({ status: "not_opened", firstOpenAt: null, openCount: 0 });
  });
});
