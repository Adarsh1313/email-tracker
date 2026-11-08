// User settings, kept in chrome.storage.local.

export interface Settings {
  /** Tracker Worker host, e.g. "email-tracker.you.workers.dev". */
  trackerHost: string;
  apiSecret: string;
  /** Addresses, domains ("family.org", "@family.org") or TLD wildcards ("*.de"). */
  neverTrack: string[];
  seedAddresses: string[];
  /** Days after an open with no reply before an email needs a follow-up. */
  followUpDays: number;
  /** Desktop notification when someone opens an email. */
  notifications: boolean;
  /** When notifications were switched on; earlier opens never notify. */
  notificationsSince: string;
}

export const DEFAULT_SETTINGS: Settings = {
  trackerHost: "",
  apiSecret: "",
  neverTrack: [],
  seedAddresses: [],
  followUpDays: 3,
  notifications: false,
  notificationsSince: "",
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  next.trackerHost = next.trackerHost.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  next.apiSecret = next.apiSecret.trim();
  await chrome.storage.local.set({ settings: next });
  return next;
}
