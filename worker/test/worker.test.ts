import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

const BASE = "https://tracker.example";
const AUTH = { Authorization: "Bearer test-secret" };

function get(path: string, init?: RequestInit) {
  return exports.default.fetch(new Request(BASE + path, init));
}

function register(token: string, sent_at = "2026-10-28T10:00:00.000Z") {
  return get("/api/tokens", {
    method: "POST",
    headers: { ...AUTH, "Content-Type": "application/json" },
    body: JSON.stringify({ token, sent_at }),
  });
}

describe("pixel", () => {
  it("returns a 43-byte transparent GIF with no-cache headers for an unknown token", async () => {
    const res = await get("/p/unknownTokenAAAAAAAAAA.gif");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
    expect(res.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate, private");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(43);
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe("GIF89a");
  });
});

describe("api auth", () => {
  it.each(["/api/health", "/api/events?since=1970-01-01T00:00:00.000Z"])("rejects %s without the bearer secret", async (path) => {
    expect((await get(path)).status).toBe(401);
    expect((await get(path, { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
  });

  it("health returns 200 with the right secret", async () => {
    expect((await get("/api/health", { headers: AUTH })).status).toBe(200);
  });
});

describe("token registration", () => {
  it("registers a token and is idempotent", async () => {
    expect((await register("tokAAAAAAAAAAAAAAAAAAA")).status).toBe(201);
    expect((await register("tokAAAAAAAAAAAAAAAAAAA")).status).toBe(201);
  });

  it("rejects malformed bodies", async () => {
    const res = await get("/api/tokens", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ token: "bad token!" }),
    });
    expect(res.status).toBe(400);
  });
});

type OpenEvent = {
  id: number;
  token: string;
  ts: string;
  user_agent: string | null;
  asn: number | null;
  as_org: string | null;
  country: string | null;
  ip_hash: string | null;
  registered_at: string;
};

async function events(after = 0, limit?: number) {
  const q = `/api/events?after=${after}` + (limit ? `&limit=${limit}` : "");
  const res = await get(q, { headers: AUTH });
  expect(res.status).toBe(200);
  return (await res.json()) as { events: OpenEvent[]; next_after: number };
}

function openPixel(token: string, ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GoogleImageProxy", ip = "203.0.113.7") {
  return exports.default.fetch(
    new Request(`${BASE}/p/${token}.gif`, {
      headers: { "User-Agent": ua, "CF-Connecting-IP": ip },
      cf: { asn: 15169, asOrganization: "Google LLC", country: "US" },
    } as RequestInit),
  );
}

describe("open events", () => {
  it("logs an open for a known token with network metadata and a hashed IP", async () => {
    await register("knownTokenAAAAAAAAAAAA");
    expect((await openPixel("knownTokenAAAAAAAAAAAA")).status).toBe(200);

    const list = (await events()).events.filter((e) => e.token === "knownTokenAAAAAAAAAAAA");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      token: "knownTokenAAAAAAAAAAAA",
      user_agent: expect.stringContaining("GoogleImageProxy"),
      asn: 15169,
      as_org: "Google LLC",
      country: "US",
    });
    expect(list[0].ip_hash).toMatch(/^[0-9a-f]{64}$/);
    // Server time of registration, so the extension never compares across clocks.
    expect(Date.parse(list[0].registered_at)).toBeLessThanOrEqual(Date.parse(list[0].ts));
    expect(JSON.stringify(list[0])).not.toContain("203.0.113.7");
  });

  it("ignores opens for unknown tokens", async () => {
    await openPixel("neverRegisteredAAAAAAA");
    expect((await events()).events.filter((e) => e.token === "neverRegisteredAAAAAAA")).toHaveLength(0);
  });

  it("pages through events with an after-cursor, oldest first", async () => {
    const start = (await events(0, 500)).next_after;
    await register("pagedTokenAAAAAAAAAAAA");
    for (let i = 0; i < 3; i++) await openPixel("pagedTokenAAAAAAAAAAAA", undefined, `198.51.100.${i + 1}`);

    const first = await events(start, 2);
    expect(first.events).toHaveLength(2);
    expect(first.events[0].id).toBeLessThan(first.events[1].id);

    const second = await events(first.next_after, 2);
    expect(second.events).toHaveLength(1);
    expect(second.events[0].id).toBeGreaterThan(first.events[1].id);

    const done = await events(second.next_after, 2);
    expect(done.events).toHaveLength(0);
    expect(done.next_after).toBe(second.next_after);
  });
});

describe("hygiene", () => {
  it("stores one event for repeat fetches from the same source within a few seconds", async () => {
    await register("dedupeTokenAAAAAAAAAAA");
    for (let i = 0; i < 3; i++) await openPixel("dedupeTokenAAAAAAAAAAA");
    expect((await events(0, 500)).events.filter((e) => e.token === "dedupeTokenAAAAAAAAAAA")).toHaveLength(1);
  });

  it("still stores a fetch from a different source straight after", async () => {
    await register("twoSourcesTokenAAAAAAA");
    await openPixel("twoSourcesTokenAAAAAAA", undefined, "192.0.2.1");
    await openPixel("twoSourcesTokenAAAAAAA", undefined, "192.0.2.2");
    expect((await events(0, 500)).events.filter((e) => e.token === "twoSourcesTokenAAAAAAA")).toHaveLength(2);
  });

  it("stops storing events after a source hits the hourly cap, but still serves the pixel", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T10:00:00Z"));
    await register("capTokenAAAAAAAAAAAAAA");
    let last: Response | undefined;
    for (let i = 0; i < 25; i++) {
      last = await openPixel("capTokenAAAAAAAAAAAAAA", undefined, "192.0.2.9");
      vi.setSystemTime(Date.now() + 6_000);
    }
    expect(last?.status).toBe(200);
    expect((await events(0, 500)).events.filter((e) => e.token === "capTokenAAAAAAAAAAAAAA")).toHaveLength(20);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function api(path: string, method: string, body?: unknown) {
  return get(path, {
    method,
    headers: { ...AUTH, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("retention and deletion", () => {
  it("defaults retention to 90 days and lets it be changed", async () => {
    expect(await (await api("/api/settings", "GET")).json()).toEqual({ retention_days: 90 });
    expect((await api("/api/settings", "PUT", { retention_days: 30 })).status).toBe(200);
    expect(await (await api("/api/settings", "GET")).json()).toEqual({ retention_days: 30 });
    expect((await api("/api/settings", "PUT", { retention_days: 0 })).status).toBe(400);
    expect((await api("/api/settings", "PUT", { retention_days: "x" })).status).toBe(400);
    await api("/api/settings", "PUT", { retention_days: 90 });
  });

  it("purges events and tokens older than the retention period, keeping newer ones", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await register("oldTokenAAAAAAAAAAAAAA", "2026-01-01T00:00:00.000Z");
    await openPixel("oldTokenAAAAAAAAAAAAAA", undefined, "192.0.2.50");
    await events(0, 1); // let the pixel's background logging finish at this fake time
    vi.setSystemTime(new Date("2026-04-01T00:00:00Z")); // 90 days later
    await register("newTokenAAAAAAAAAAAAAA", "2026-04-01T00:00:00.000Z");
    await openPixel("newTokenAAAAAAAAAAAAAA", undefined, "192.0.2.51");
    await events(0, 1);
    vi.setSystemTime(new Date("2026-04-05T00:00:00Z"));

    expect((await api("/api/purge", "POST")).status).toBe(200);

    const tokens = (await events(0, 500)).events.map((e) => e.token);
    expect(tokens).not.toContain("oldTokenAAAAAAAAAAAAAA");
    expect(tokens).toContain("newTokenAAAAAAAAAAAAAA");
  });

  it("deletes every event and token on request", async () => {
    await register("wipeTokenAAAAAAAAAAAAA");
    await openPixel("wipeTokenAAAAAAAAAAAAA", undefined, "192.0.2.60");
    expect((await events(0, 500)).events.length).toBeGreaterThan(0);
    expect((await api("/api/events", "DELETE")).status).toBe(200);
    expect((await events(0, 500)).events).toHaveLength(0);
  });
});
