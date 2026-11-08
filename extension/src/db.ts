// Local IndexedDB store for recipient data. Only the extension pages and the
// background worker open it; the content script goes through messages.
import type { OpenEvent, SelfView, TrackedEmail } from "./core/types";

const DB_NAME = "email-tracker";
const DB_VERSION = 2;

type StoreName = "emails" | "opens" | "selfViews" | "meta" | "overrides";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      // v2 adds "That was me" overrides; v1 stores are left as they are.
      if (event.oldVersion < 2) db.createObjectStore("overrides", { keyPath: "openId" });
      if (event.oldVersion >= 1) return;
      const emails = db.createObjectStore("emails", { keyPath: "id" });
      emails.createIndex("token", "token", { unique: false });
      emails.createIndex("sentAt", "sentAt");
      const opens = db.createObjectStore("opens", { keyPath: "id" });
      opens.createIndex("token", "token");
      const selfViews = db.createObjectStore("selfViews", { autoIncrement: true });
      selfViews.createIndex("token", "token");
      db.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: StoreName, mode: IDBTransactionMode = "readonly"): Promise<IDBObjectStore> {
  return (await open()).transaction(name, mode).objectStore(name);
}

async function putAll<T>(name: StoreName, items: T[]): Promise<void> {
  if (!items.length) return;
  const tx = (await open()).transaction(name, "readwrite");
  for (const item of items) tx.objectStore(name).put(item);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const db = {
  async allEmails(): Promise<TrackedEmail[]> {
    return done((await store("emails")).getAll());
  },
  async getEmail(id: string): Promise<TrackedEmail | undefined> {
    return done((await store("emails")).get(id));
  },
  async emailByToken(token: string): Promise<TrackedEmail | undefined> {
    return done((await store("emails")).index("token").get(token));
  },
  async putEmail(email: TrackedEmail): Promise<void> {
    await done((await store("emails", "readwrite")).put(email));
  },
  async deleteEmail(id: string): Promise<void> {
    await done((await store("emails", "readwrite")).delete(id));
  },
  /** Raw open events; classified on read, because self-views can arrive later. */
  async allOpens(): Promise<OpenEvent[]> {
    return done((await store("opens")).getAll());
  },
  async putOpens(opens: OpenEvent[]): Promise<void> {
    await putAll("opens", opens);
  },
  async allSelfViews(): Promise<SelfView[]> {
    return done((await store("selfViews")).getAll());
  },
  async addSelfViews(views: SelfView[]): Promise<void> {
    if (!views.length) return;
    const tx = (await open()).transaction("selfViews", "readwrite");
    for (const v of views) tx.objectStore("selfViews").add(v);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  /** Ids of opens I marked as mine ("That was me"). */
  async overriddenOpenIds(): Promise<Set<number>> {
    const keys = await done((await store("overrides")).getAllKeys());
    return new Set(keys as number[]);
  },
  async addOverride(openId: number): Promise<void> {
    await done((await store("overrides", "readwrite")).put({ openId, classification: "self", at: new Date().toISOString() }));
  },
  async removeOverride(openId: number): Promise<void> {
    await done((await store("overrides", "readwrite")).delete(openId));
  },
  /** Wipes emails, opens, self-views and overrides. Settings stay, and so do the sync cursor, notify state and setup-check markers in meta (clearing them would re-download Worker events). */
  async clearAll(): Promise<void> {
    const names: StoreName[] = ["emails", "opens", "selfViews", "overrides"];
    const tx = (await open()).transaction(names, "readwrite");
    for (const n of names) tx.objectStore(n).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async getMeta<T>(key: string): Promise<T | undefined> {
    return done((await store("meta")).get(key));
  },
  async setMeta(key: string, value: unknown): Promise<void> {
    await done((await store("meta", "readwrite")).put(value, key));
  },
};
