// First-load pre-fill: `npm run setup` writes dist/prefill.json (Worker address and
// secret). Applied once, and only when Settings are still empty, so it never
// overwrites what the user typed.
import { getSettings, saveSettings } from "./settings";

const APPLIED_KEY = "prefillApplied";

export async function applyPrefill(): Promise<void> {
  try {
    if ((await chrome.storage.local.get(APPLIED_KEY))[APPLIED_KEY]) return;
    const res = await fetch(chrome.runtime.getURL("prefill.json"));
    if (!res.ok) return; // no prefill shipped: nothing to do, and not worth remembering
    const { trackerHost, apiSecret } = (await res.json()) as { trackerHost?: string; apiSecret?: string };
    const current = await getSettings();
    if (trackerHost && apiSecret && !current.trackerHost && !current.apiSecret) await saveSettings({ trackerHost, apiSecret });
    await chrome.storage.local.set({ [APPLIED_KEY]: true });
  } catch {
    /* fail quiet: the user can type the values in Settings */
  }
}
