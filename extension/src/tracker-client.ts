// HTTP client for the Tracker Worker's /api.
import type { OpenEvent } from "./core/types";
import type { Settings } from "./settings";

function headers(settings: Settings): HeadersInit {
  return { Authorization: `Bearer ${settings.apiSecret}`, "Content-Type": "application/json" };
}

function base(settings: Settings): string {
  if (!settings.trackerHost || !settings.apiSecret) throw new Error("Tracker isn't set up yet");
  return `https://${settings.trackerHost}`;
}

export async function registerToken(settings: Settings, token: string, sentAt: string, timeoutMs: number): Promise<void> {
  const res = await fetch(`${base(settings)}/api/tokens`, {
    method: "POST",
    headers: headers(settings),
    body: JSON.stringify({ token, sent_at: sentAt }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status !== 201) throw new Error(`Tracker returned ${res.status}`);
}

export async function fetchEvents(
  settings: Settings,
  after: number,
  limit: number,
): Promise<{ events: OpenEvent[]; next_after: number }> {
  const res = await fetch(`${base(settings)}/api/events?after=${after}&limit=${limit}`, {
    headers: headers(settings),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Tracker returned ${res.status}`);
  return res.json();
}

/** Resolves with a human-readable problem, or null when the tracker is reachable and the secret is valid. */
export async function checkTracker(settings: Settings): Promise<string | null> {
  try {
    const res = await fetch(`${base(settings)}/api/health`, { headers: headers(settings), signal: AbortSignal.timeout(5_000) });
    if (res.status === 401) return "The API secret doesn't match the Worker's API_SECRET.";
    if (!res.ok) return `The tracker answered with status ${res.status}.`;
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "The tracker couldn't be reached.";
  }
}

export type WorkerProbe = "ok" | "unreachable" | "bad-secret";

/** Like checkTracker, but says which part failed (for the setup checklist). */
export async function probeTracker(settings: Settings): Promise<WorkerProbe> {
  try {
    const res = await fetch(`${base(settings)}/api/health`, { headers: headers(settings), signal: AbortSignal.timeout(5_000) });
    if (res.status === 401) return "bad-secret";
    return res.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function getRetentionDays(settings: Settings): Promise<number> {
  const res = await fetch(`${base(settings)}/api/settings`, { headers: headers(settings), signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`Tracker returned ${res.status}`);
  return ((await res.json()) as { retention_days: number }).retention_days;
}

export async function setRetentionDays(settings: Settings, days: number): Promise<void> {
  const res = await fetch(`${base(settings)}/api/settings`, {
    method: "PUT",
    headers: headers(settings),
    body: JSON.stringify({ retention_days: days }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Tracker returned ${res.status}`);
}

/** Deletes every open event and token on the Worker. Local data is untouched. */
export async function deleteAllWorkerEvents(settings: Settings): Promise<void> {
  const res = await fetch(`${base(settings)}/api/events`, { method: "DELETE", headers: headers(settings), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Tracker returned ${res.status}`);
}
