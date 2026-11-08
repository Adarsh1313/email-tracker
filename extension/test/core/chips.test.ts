import { describe, expect, it } from "vitest";
import { normalizeSubject, pickChip, sentChips } from "../../src/core/chips";
import type { EmailRow } from "../../src/core/rows";
import type { Status } from "../../src/core/types";

function row(subject: string, status: Status, openCount = 0, sentAt = "2026-11-01T10:00:00.000Z"): EmailRow {
  return {
    email: { id: subject + sentAt, token: "t", tracked: status !== "untracked", to: ["a@b.co"], subject, sentAt, company: "", role: "", variant: "", seedTest: false },
    status,
    firstOpenAt: null,
    lastActivityAt: sentAt,
    opens: [],
    openCount,
  };
}

describe("normalizeSubject", () => {
  it("ignores case, spacing and reply prefixes", () => {
    expect(normalizeSubject("  RE: Fwd:  Platform   role ")).toBe("platform role");
  });
});

function pick(rows: EmailRow[], subject: string, addresses: string[]) {
  return pickChip(sentChips(rows)[normalizeSubject(subject)], addresses);
}

describe("pickChip", () => {
  const to = (r: EmailRow, ...addrs: string[]) => ((r.email.to = addrs), r);

  it("shows the open count for opened emails", () => {
    expect(pick([row("Hi", "opened", 3)], "Hi", [])).toEqual({ text: "Opened 3×", status: "opened" });
  });

  it("shows Opened without a count for a single open", () => {
    expect(pick([row("Hi", "opened", 1)], "Hi", [])?.text).toBe("Opened");
  });

  it("marks uncertain opens, replies, bounces and unopened mail", () => {
    expect(pick([row("A", "opened_uncertain", 1)], "A", [])?.text).toBe("Opened (uncertain)");
    expect(pick([row("A", "replied", 2)], "A", [])?.text).toBe("Replied");
    expect(pick([row("A", "bounced")], "A", [])?.text).toBe("Bounced");
    expect(pick([row("A", "not_opened")], "A", [])?.text).toBe("Not opened");
  });

  it("gives untracked emails no chip", () => {
    expect(pick([row("Hi", "untracked")], "Hi", [])).toBeNull();
  });

  it("matches a repeated subject by recipient address", () => {
    const rows = [to(row("Hi", "replied", 1, "2026-11-01T10:00:00.000Z"), "a@one.co"), to(row("Hi", "not_opened", 0, "2026-11-05T10:00:00.000Z"), "b@two.co")];
    expect(pick(rows, "Hi", ["A@one.co"])?.text).toBe("Replied");
    expect(pick(rows, "Hi", ["b@two.co"])?.text).toBe("Not opened");
  });

  it("gives no chip for a repeated subject when the row shows no address", () => {
    const rows = [to(row("Hi", "replied"), "a@one.co"), to(row("Hi", "opened", 1, "2026-11-05T10:00:00.000Z"), "b@two.co")];
    expect(pick(rows, "Hi", [])).toBeNull();
  });

  it("gives no chip when the row's recipient matches no record", () => {
    expect(pick([to(row("Hi", "opened", 1), "a@one.co")], "Hi", ["z@zz.co"])).toBeNull();
  });
});
