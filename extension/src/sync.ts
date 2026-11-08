// Pulls new open events from the Tracker Worker into the local store.
// Every event is kept: the Worker only knows our tokens, and an event whose
// email record is missing (say, the record failed to save) must not be lost
// once the cursor moves past it. Rows join events to emails on read.
import { db } from "./db";
import { getSettings } from "./settings";
import { fetchEvents } from "./tracker-client";

const CURSOR_KEY = "eventsAfter";
const PAGE_SIZE = 500;
let running: Promise<number> | null = null;

/** Returns how many new open events were stored. */
export function syncOpens(): Promise<number> {
  running ??= (async () => {
    const settings = await getSettings();
    if (!settings.trackerHost || !settings.apiSecret) return 0;
    let after = (await db.getMeta<number>(CURSOR_KEY)) ?? 0;
    let stored = 0;
    for (;;) {
      const page = await fetchEvents(settings, after, PAGE_SIZE);
      await db.putOpens(page.events);
      stored += page.events.length;
      after = page.next_after;
      await db.setMeta(CURSOR_KEY, after);
      if (page.events.length < PAGE_SIZE) return stored;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
