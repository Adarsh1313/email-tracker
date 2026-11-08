// 1×1 transparent GIF (43 bytes).
const PIXEL = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="),
  (c) => c.charCodeAt(0),
);

const PIXEL_HEADERS = {
  "Content-Type": "image/gif",
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
};

const DEDUPE_MS = 5_000;
const HOURLY_CAP = 20; // stored opens per token per source per hour
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function authorized(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${env.API_SECRET}`;
  if (!env.API_SECRET || header.length !== expected.length) return false;
  // Constant-time compare.
  let diff = 0;
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function registerToken(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { token?: unknown; sent_at?: unknown } | null;
  const token = body?.token;
  const sentAt = body?.sent_at;
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return json({ error: "invalid token" }, 400);
  if (typeof sentAt !== "string" || Number.isNaN(Date.parse(sentAt))) return json({ error: "invalid sent_at" }, 400);
  await env.DB.prepare("INSERT OR IGNORE INTO tokens (token, sent_at, created_at) VALUES (?, ?, ?)")
    .bind(token, new Date(sentAt).toISOString(), new Date().toISOString())
    .run();
  return json({ ok: true }, 201);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Logs an open only for registered tokens. Never stores the raw IP.
async function logOpen(request: Request, env: Env, token: string): Promise<void> {
  const known = await env.DB.prepare("SELECT 1 FROM tokens WHERE token = ?").bind(token).first();
  if (!known) return;
  const cf = (request.cf ?? {}) as { asn?: number; asOrganization?: string; country?: string };
  const ip = request.headers.get("CF-Connecting-IP");
  const ipHash = ip ? await sha256Hex(`${env.IP_SALT}:${ip}`) : null;
  const now = Date.now();
  // Image-loading bursts from one source count once.
  const recent = await env.DB.prepare("SELECT 1 FROM opens WHERE token = ? AND ip_hash IS ? AND ts > ? LIMIT 1")
    .bind(token, ipHash, new Date(now - DEDUPE_MS).toISOString())
    .first();
  if (recent) return;
  // Keep one noisy source from filling the database.
  const hourly = await env.DB.prepare("SELECT COUNT(*) AS n FROM opens WHERE token = ? AND ip_hash IS ? AND ts > ?")
    .bind(token, ipHash, new Date(now - 3_600_000).toISOString())
    .first<{ n: number }>();
  if ((hourly?.n ?? 0) >= HOURLY_CAP) return;
  await env.DB.prepare(
    "INSERT INTO opens (token, ts, user_agent, asn, as_org, country, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      token,
      new Date(now).toISOString(),
      request.headers.get("User-Agent"),
      cf.asn ?? null,
      cf.asOrganization ?? null,
      cf.country ?? null,
      ipHash,
    )
    .run();
}

async function listEvents(url: URL, env: Env): Promise<Response> {
  const after = Math.max(0, Number.parseInt(url.searchParams.get("after") ?? "0", 10) || 0);
  const limit = Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "200", 10) || 200));
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.token, o.ts, o.user_agent, o.asn, o.as_org, o.country, o.ip_hash, t.created_at AS registered_at
     FROM opens o JOIN tokens t ON t.token = o.token
     WHERE o.id > ? ORDER BY o.id LIMIT ?`,
  )
    .bind(after, limit)
    .all<{ id: number }>();
  const nextAfter = results.length ? results[results.length - 1].id : after;
  return json({ events: results, next_after: nextAfter });
}

const DEFAULT_RETENTION_DAYS = 90;

async function getRetentionDays(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'retention_days'").first<{ value: string }>();
  const days = row ? Number.parseInt(row.value, 10) : NaN;
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS;
}

async function putSettings(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { retention_days?: unknown } | null;
  const days = body?.retention_days;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 3650) {
    return json({ error: "retention_days must be a whole number from 1 to 3650" }, 400);
  }
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('retention_days', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(String(days))
    .run();
  return json({ retention_days: days });
}

// Deletes opens, then tokens, older than the retention period.
async function purgeOld(env: Env): Promise<{ retention_days: number }> {
  const days = await getRetentionDays(env);
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM opens WHERE ts < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM tokens WHERE created_at < ? AND token NOT IN (SELECT token FROM opens)").bind(cutoff),
  ]);
  return { retention_days: days };
}

async function deleteAll(env: Env): Promise<Response> {
  await env.DB.batch([env.DB.prepare("DELETE FROM opens"), env.DB.prepare("DELETE FROM tokens")]);
  return json({ ok: true });
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);
  if (path === "/api/health" && request.method === "GET") return json({ ok: true });
  if (path === "/api/tokens" && request.method === "POST") return registerToken(request, env);
  if (path === "/api/events" && request.method === "GET") return listEvents(new URL(request.url), env);
  if (path === "/api/events" && request.method === "DELETE") return deleteAll(env);
  if (path === "/api/settings" && request.method === "GET") return json({ retention_days: await getRetentionDays(env) });
  if (path === "/api/settings" && request.method === "PUT") return putSettings(request, env);
  if (path === "/api/purge" && request.method === "POST") return json(await purgeOld(env));
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pixel = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{1,64})\.gif$/);
    if (pixel) {
      // Respond immediately; logging must never delay or break the image.
      ctx.waitUntil(logOpen(request, env, pixel[1]).catch(() => {}));
      return new Response(PIXEL, { headers: PIXEL_HEADERS });
    }
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url.pathname);
    return new Response("Not found", { status: 404 });
  },
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(purgeOld(env));
  },
} satisfies ExportedHandler<Env>;
