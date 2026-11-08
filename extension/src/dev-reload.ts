// Dev builds only (npm run dev): reload the extension when dist/ is rebuilt,
// then refresh open Gmail tabs so they pick up the new content script.
// Unpacked extensions serve files straight from disk, so fetching our own
// dev-reload.json always returns the latest build id.
declare const __DEV_RELOAD__: boolean;

const POLL_MS = 1000;
const RELOADED_KEY = "devReloaded";

async function buildId(): Promise<number | null> {
  try {
    const res = await fetch(chrome.runtime.getURL("dev-reload.json"), { cache: "no-store" });
    return ((await res.json()) as { id: number }).id;
  } catch {
    return null;
  }
}

export async function startDevReload(): Promise<void> {
  if (!__DEV_RELOAD__) return;

  if ((await chrome.storage.session.get(RELOADED_KEY))[RELOADED_KEY]) {
    await chrome.storage.session.remove(RELOADED_KEY);
    for (const tab of await chrome.tabs.query({ url: "https://mail.google.com/*" })) {
      if (tab.id !== undefined) void chrome.tabs.reload(tab.id);
    }
  }

  const first = await buildId();
  setInterval(async () => {
    // Calling an extension API keeps the service worker awake between polls.
    await chrome.runtime.getPlatformInfo();
    const id = await buildId();
    if (id === null || id === first) return;
    await chrome.storage.session.set({ [RELOADED_KEY]: true });
    chrome.runtime.reload();
  }, POLL_MS);
}
