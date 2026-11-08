// Background service worker: token registration, local records, sync.
import { newToken, pixelUrl } from "./core/pixel";
import { isNeverTrack, isSeedSend, prefillTags } from "./core/tags";
import type { TrackedEmail } from "./core/types";
import { db } from "./db";
import { startDevReload } from "./dev-reload";
import type { ComposeState, ContentConfig, DataChanged, Message, PrepareSendResult, SendRecord } from "./messages";
import { connectGmail, syncGmail } from "./gmail";
import { applyPrefill } from "./prefill";
import { sentChips } from "./core/chips";
import { buildRows } from "./core/rows";
import { pendingNotifications, type NotifyState } from "./core/notifications";
import { getSettings } from "./settings";
import { syncOpens } from "./sync";
import { registerToken } from "./tracker-client";

const REGISTER_TIMEOUT_MS = 1500;
const PENDING_SPLITS_KEY = "pendingSplits";
/** Short, so an abandoned draft can't lend its group to an unrelated later email. */
const SPLIT_TTL_MS = 15 * 60_000;

/** "partial": some drafts opened, so the original must not be sent as a fallback. */
type SplitResult = "all" | "partial" | "none";

interface PendingSplit {
  groupId: string;
  to: string;
  subject: string;
  at: number;
}

/** Prototype "Send separately": opens one prefilled single-recipient compose per address. Nothing is sent for you. */
async function startSplit(msg: Extract<Message, { type: "start-split" }>): Promise<SplitResult> {
  if (msg.to.length < 2 || msg.to.length > 5) return "none";
  const groupId = crypto.randomUUID();
  const now = Date.now();
  const kept = ((await db.getMeta<PendingSplit[]>(PENDING_SPLITS_KEY)) ?? []).filter((p) => now - p.at < SPLIT_TTL_MS);
  await db.setMeta(PENDING_SPLITS_KEY, [...kept, ...msg.to.map((to) => ({ groupId, to, subject: msg.subject, at: now }))]);
  let opened = 0;
  try {
    for (const to of msg.to) {
      const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(msg.bodyText)}`;
      await chrome.tabs.create({ url, active: false });
      opened++;
    }
  } catch (err) {
    console.warn("[email-tracker] split failed", err);
  }
  if (opened === msg.to.length) return "all";
  if (opened === 0) {
    const pending = (await db.getMeta<PendingSplit[]>(PENDING_SPLITS_KEY)) ?? [];
    await db.setMeta(PENDING_SPLITS_KEY, pending.filter((p) => p.groupId !== groupId));
    return "none";
  }
  return "partial";
}

/** The group a single-recipient send belongs to, if it came from a split. Consumed once. */
async function takeSplitGroup(to: string[], subject: string): Promise<string | undefined> {
  if (to.length !== 1) return undefined;
  const now = Date.now();
  const pending = ((await db.getMeta<PendingSplit[]>(PENDING_SPLITS_KEY)) ?? []).filter((p) => now - p.at < SPLIT_TTL_MS);
  const hit = pending.find((p) => p.to === to[0] && p.subject === subject);
  if (!hit) return undefined;
  await db.setMeta(PENDING_SPLITS_KEY, pending.filter((p) => p !== hit));
  return hit.groupId;
}

/** Tells an open dashboard to re-render. Nobody listening is fine. */
function notifyDataChanged(): void {
  chrome.runtime.sendMessage({ type: "data-changed" } satisfies DataChanged).catch(() => {});
}

async function composeState(to: string[]): Promise<ComposeState> {
  const settings = await getSettings();
  if (!settings.trackerHost || !settings.apiSecret) return { track: false, reason: "not-set-up" };
  if (isNeverTrack(to, settings.neverTrack)) return { track: false, reason: "never-track" };
  return { track: true, reason: "on" };
}

async function prepareSend(msg: Extract<Message, { type: "prepare-send" }>): Promise<PrepareSendResult> {
  const settings = await getSettings();
  const seedTest = isSeedSend(msg.to, settings.seedAddresses);
  const state = await composeState(msg.to);
  if (!state.track) return { ok: false, reason: state.reason === "on" ? "off" : state.reason, seedTest };
  if (!msg.trackingOn) return { ok: false, reason: "off", seedTest };

  const token = newToken();
  try {
    await registerToken(settings, token, msg.sentAt, REGISTER_TIMEOUT_MS);
  } catch {
    return { ok: false, reason: "tracker-unreachable", seedTest };
  }
  const groupId = await takeSplitGroup(msg.to, msg.subject);
  return { ok: true, token, pixelUrl: pixelUrl(settings.trackerHost, token), seedTest, groupId };
}

async function recordSend(record: SendRecord): Promise<void> {
  const email: TrackedEmail = {
    id: record.token ?? crypto.randomUUID(),
    token: record.token,
    tracked: record.token !== null,
    to: record.to,
    subject: record.subject,
    sentAt: record.sentAt,
    seedTest: record.seedTest,
    ...(record.groupId ? { groupId: record.groupId } : {}),
    ...prefillTags(record.to, record.subject),
  };
  await db.putEmail(email);
  notifyDataChanged();
}

async function handle(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case "compose-state":
      return composeState(msg.to);
    case "prepare-send":
      return prepareSend(msg);
    case "record-send":
      return recordSend(msg.record);
    case "self-views":
      await db.addSelfViews(msg.tokens.map((token) => ({ token, ts: msg.ts })));
      notifyDataChanged();
      return;
    case "get-config":
      await db.setMeta("gmailTabSeenAt", new Date().toISOString());
      return { trackerHost: (await getSettings()).trackerHost } satisfies ContentConfig;
    case "start-split":
      return startSplit(msg);
    case "sent-chips": {
      const [emails, opens, selfViews, overrides] = await Promise.all([db.allEmails(), db.allOpens(), db.allSelfViews(), db.overriddenOpenIds()]);
      return sentChips(buildRows(emails, opens, selfViews, undefined, overrides));
    }
    case "sync-now": {
      // Gmail problems must not look like a tracker outage, so they're only logged.
      const [stored] = await Promise.all([syncOpens(), runGmailSync()]);
      return stored;
    }
    case "gmail-connect": {
      const state = await connectGmail();
      void runGmailSync();
      return state;
    }
  }
}

async function runGmailSync(): Promise<void> {
  try {
    if ((await syncGmail()) > 0) notifyDataChanged();
  } catch (err) {
    console.warn("[email-tracker] Gmail sync failed", err);
  }
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  handle(msg).then(sendResponse, (err) => {
    console.error("[email-tracker]", err);
    sendResponse(undefined);
  });
  return true; // async response
});

// Toolbar icon opens (or focuses) the dashboard.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("dashboard.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

const NOTIFY_STATE_KEY = "notifyState";

/** Desktop notifications for new opens (see core/notifications for the rules). */
async function notifyNewOpens(): Promise<void> {
  const settings = await getSettings();
  if (!settings.notifications || !settings.notificationsSince) return;
  const [emails, opens, selfViews, overrides, state] = await Promise.all([
    db.allEmails(),
    db.allOpens(),
    db.allSelfViews(),
    db.overriddenOpenIds(),
    db.getMeta<NotifyState>(NOTIFY_STATE_KEY),
  ]);
  const rows = buildRows(emails, opens, selfViews, undefined, overrides);
  const pending = pendingNotifications(rows, state ?? {}, Date.now(), settings.notificationsSince);
  if (!pending.length) return;
  const next = { ...(state ?? {}) };
  for (const n of pending) {
    next[n.emailId] = n.openTs;
    chrome.notifications.create(`open-${n.emailId}-${n.openTs}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png"),
      title: n.title,
      message: n.body,
    });
  }
  await db.setMeta(NOTIFY_STATE_KEY, next);
}

chrome.notifications.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

// While Chrome is open: opens every minute; Gmail replies and bounces every
// 5 minutes (slower, to stay light on Gmail quota).
const SYNC_ALARM = "sync";
const GMAIL_ALARM = "gmail";
function createAlarms(): void {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(GMAIL_ALARM, { periodInMinutes: 5 });
}
chrome.runtime.onInstalled.addListener(createAlarms);
chrome.runtime.onStartup.addListener(createAlarms);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === GMAIL_ALARM) void runGmailSync();
  if (alarm.name !== SYNC_ALARM) return;
  syncOpens()
    .then((stored) => stored > 0 && notifyDataChanged())
    .then(() => notifyNewOpens())
    .catch((err) => console.warn("[email-tracker] sync failed", err));
});

void applyPrefill();
void startDevReload();
