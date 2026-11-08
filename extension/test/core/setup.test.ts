import { describe, expect, it } from "vitest";
import { setupChecklist, type SetupFacts } from "../../src/core/setup";

const ready: SetupFacts = {
  configured: true,
  worker: "ok",
  gmailTabSeen: true,
  gmailSync: "connected",
  testOpenSeen: true,
};

const byId = (facts: SetupFacts) => Object.fromEntries(setupChecklist(facts).map((i) => [i.id, i]));

describe("setupChecklist", () => {
  it("is all done when everything works", () => {
    const items = setupChecklist(ready);
    expect(items.map((i) => i.state)).toEqual(["done", "done", "done", "done", "done"]);
    expect(items.every((i) => i.fix === null)).toBe(true);
  });

  it("fails both worker checks with a fix when nothing is configured", () => {
    const items = byId({ ...ready, configured: false, worker: "unknown" });
    expect(items.reachable.state).toBe("todo");
    expect(items.reachable.fix).toMatch(/host/i);
    expect(items.secret.state).toBe("todo");
  });

  it("an unreachable worker fails reachability and leaves the secret unchecked", () => {
    const items = byId({ ...ready, worker: "unreachable" });
    expect(items.reachable.state).toBe("failed");
    expect(items.reachable.fix).toBeTruthy();
    expect(items.secret.state).toBe("todo");
  });

  it("a rejected secret passes reachability but fails the secret", () => {
    const items = byId({ ...ready, worker: "bad-secret" });
    expect(items.reachable.state).toBe("done");
    expect(items.secret.state).toBe("failed");
    expect(items.secret.fix).toMatch(/API_SECRET/);
  });

  it("marks Gmail sync optional and never failed when disconnected", () => {
    const sync = byId({ ...ready, gmailSync: "disconnected" }).sync;
    expect(sync.optional).toBe(true);
    expect(sync.state).toBe("todo");
  });

  it("flags expired Gmail access as needing a reconnect", () => {
    const sync = byId({ ...ready, gmailSync: "reconnect" }).sync;
    expect(sync.state).toBe("failed");
    expect(sync.fix).toMatch(/reconnect/i);
  });

  it("the test open stays todo until one arrives", () => {
    const item = byId({ ...ready, testOpenSeen: false }).testOpen;
    expect(item.state).toBe("todo");
    expect(item.fix).toMatch(/test email/i);
  });
});
