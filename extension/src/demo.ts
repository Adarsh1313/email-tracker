// Demo data: `npm run demo-data` writes dist/demo-data.json. The dashboard imports
// it once per file (by id). Demo records have ids starting "demo-"; "Delete all my
// local data" in Settings removes them.
import type { OpenEvent, TrackedEmail } from "./core/types";
import { db } from "./db";

interface DemoFile {
  id: string;
  emails: TrackedEmail[];
  opens: OpenEvent[];
}

/** Returns true when new demo data was imported. */
export async function loadDemoData(): Promise<boolean> {
  try {
    const res = await fetch(chrome.runtime.getURL("demo-data.json"), { cache: "no-store" });
    if (!res.ok) return false;
    const demo = (await res.json()) as DemoFile;
    if ((await db.getMeta<string>("demoLoaded")) === demo.id) return false;
    for (const email of demo.emails) await db.putEmail(email);
    await db.putOpens(demo.opens);
    await db.setMeta("demoLoaded", demo.id);
    return true;
  } catch {
    return false;
  }
}
