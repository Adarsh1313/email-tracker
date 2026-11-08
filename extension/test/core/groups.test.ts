import { describe, expect, it } from "vitest";
import { groupRows } from "../../src/core/groups";
import type { EmailRow } from "../../src/core/rows";
import type { Status } from "../../src/core/types";

function row(id: string, to: string, status: Status, groupId?: string, sentAt = "2026-11-01T10:00:00.000Z"): EmailRow {
  return {
    email: { id, token: id, tracked: true, to: [to], subject: "Hi", sentAt, company: "", role: "", variant: "", seedTest: false, groupId },
    status,
    firstOpenAt: null,
    lastActivityAt: sentAt,
    opens: [],
    openCount: 0,
  };
}

describe("groupRows", () => {
  it("leaves ungrouped emails as groups of one", () => {
    const groups = groupRows([row("a", "a@x.co", "opened"), row("b", "b@x.co", "not_opened")]);
    expect(groups.map((g) => g.members.length)).toEqual([1, 1]);
  });

  it("merges separate-send copies into one group in position of the newest copy", () => {
    const groups = groupRows([
      row("c", "c@x.co", "not_opened", undefined, "2026-11-03T10:00:00.000Z"),
      row("a", "a@x.co", "opened", "g1", "2026-11-02T10:00:00.000Z"),
      row("b", "b@x.co", "not_opened", "g1", "2026-11-02T10:00:01.000Z"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[1].members.map((m) => m.email.id)).toEqual(["b", "a"]);
  });

  it("takes the strongest member status", () => {
    const [g] = groupRows([row("a", "a@x.co", "not_opened", "g"), row("b", "b@x.co", "replied", "g"), row("c", "c@x.co", "opened", "g")]);
    expect(g.status).toBe("replied");
  });

  it("is bounced only when every copy bounced", () => {
    expect(groupRows([row("a", "a@x.co", "bounced", "g"), row("b", "b@x.co", "opened", "g")])[0].status).toBe("opened");
    expect(groupRows([row("a", "a@x.co", "bounced", "g"), row("b", "b@x.co", "bounced", "g")])[0].status).toBe("bounced");
  });

  it("lists who engaged", () => {
    const [g] = groupRows([row("a", "a@x.co", "opened", "g"), row("b", "b@x.co", "not_opened", "g"), row("c", "c@x.co", "replied", "g")]);
    expect(g.engaged.sort()).toEqual(["a@x.co", "c@x.co"]);
  });
});
