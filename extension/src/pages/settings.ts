import { setupChecklist, type SetupFacts, type SetupItem } from "../core/setup";
import { db } from "../db";
import { getGmailState, type GmailState } from "../gmail";
import { applyPrefill } from "../prefill";
import { send } from "../messages";
import { getSettings, saveSettings, type Settings } from "../settings";
import { checkTracker, deleteAllWorkerEvents, getRetentionDays, probeTracker, setRetentionDays } from "../tracker-client";

const form = document.querySelector<HTMLFormElement>("#settings")!;
const field = <T extends HTMLInputElement | HTMLTextAreaElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const out = (id: string) => document.querySelector<HTMLOutputElement>(`#${id}`)!;
const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

let loadedRetention: number | null = null;

function read(): Partial<Settings> {
  return {
    trackerHost: field("trackerHost").value,
    apiSecret: field("apiSecret").value,
    neverTrack: lines(field("neverTrack").value),
    seedAddresses: lines(field("seedAddresses").value),
    followUpDays: Number(field("followUpDays").value) || 3,
    notifications: field<HTMLInputElement>("notifications").checked,
  };
}

async function load() {
  const s = await getSettings();
  field("trackerHost").value = s.trackerHost;
  field("apiSecret").value = s.apiSecret;
  field("neverTrack").value = s.neverTrack.join("\n");
  field("seedAddresses").value = s.seedAddresses.join("\n");
  field("followUpDays").value = String(s.followUpDays);
  field<HTMLInputElement>("notifications").checked = s.notifications;
}

function say(el: HTMLOutputElement, text: string, error = false): void {
  el.value = text;
  el.classList.toggle("is-error", error);
}

// ---------- Setup checklist ----------

const MARKS = {
  done: '<path d="M6 12.5 10.5 17 18 7.5" />',
  todo: '<path d="M7 12h10" />',
  failed: '<path d="M7 7l10 10" /><path d="M17 7 7 17" />',
};
const STAMP_STATUS = { done: "opened", todo: "untracked", failed: "bounced" } as const;

function renderChecklist(items: SetupItem[]): void {
  const list = document.querySelector("#checklist")!;
  list.replaceChildren(
    ...items.map((i) => {
      const li = document.createElement("li");
      li.className = "check";
      li.dataset.state = i.state;
      li.innerHTML = `<span class="stamp" data-status="${STAMP_STATUS[i.state]}" role="img" aria-label="${i.state === "done" ? "Done" : i.state === "failed" ? "Needs attention" : "Not done yet"}"><svg viewBox="0 0 24 24" aria-hidden="true">${MARKS[i.state]}</svg></span><div><span class="check-label"></span><span class="check-fix" ${i.fix ? "" : "hidden"}></span></div>`;
      li.querySelector(".check-label")!.textContent = i.label;
      if (i.optional) {
        const tag = document.createElement("span");
        tag.className = "optional";
        tag.textContent = " (optional)";
        li.querySelector(".check-label")!.append(tag);
      }
      if (i.fix) li.querySelector(".check-fix")!.textContent = i.fix;
      return li;
    }),
  );
}

/** A test open is any open that arrived after the Send a test email button was pressed. */
async function testOpenArrived(): Promise<boolean> {
  const startedAt = await db.getMeta<string>("testEmailStartedAt");
  if (!startedAt) return false;
  return (await db.allOpens()).some((o) => o.ts >= startedAt);
}

async function gatherFacts(): Promise<SetupFacts> {
  const settings = await getSettings();
  const configured = Boolean(settings.trackerHost && settings.apiSecret);
  const worker = configured ? await probeTracker(settings) : "unknown";
  if (worker === "ok") await send({ type: "sync-now" }).catch(() => undefined);
  const gmail = await getGmailState();
  return {
    configured,
    worker,
    gmailTabSeen: Boolean(await db.getMeta<string>("gmailTabSeenAt")),
    gmailSync: gmail.status,
    testOpenSeen: await testOpenArrived(),
  };
}

async function refreshChecklist(): Promise<SetupFacts> {
  const facts = await gatherFacts();
  renderChecklist(setupChecklist(facts));
  return facts;
}

/** After a test email is sent, re-check every 10 s for up to 5 minutes, until the open arrives. */
let polling: ReturnType<typeof setInterval> | undefined;
function pollForTestOpen(): void {
  clearInterval(polling);
  const stopAt = Date.now() + 5 * 60_000;
  polling = setInterval(async () => {
    const facts = await refreshChecklist();
    if (facts.testOpenSeen || Date.now() > stopAt) {
      clearInterval(polling);
      if (facts.testOpenSeen) say(out("testEmailHint"), "Test open received. Tracking works end to end.");
    }
  }, 10_000);
}

document.querySelector("#recheck")!.addEventListener("click", () => void refreshChecklist());

document.querySelector("#testEmail")!.addEventListener("click", async () => {
  const gmail = await getGmailState();
  const to = gmail.address ? `&to=${encodeURIComponent(gmail.address)}` : "";
  await db.setMeta("testEmailStartedAt", new Date().toISOString());
  window.open(`https://mail.google.com/mail/?view=cm&fs=1${to}&su=${encodeURIComponent("Tracker test")}&body=${encodeURIComponent("Test.")}`, "_blank");
  say(out("testEmailHint"), "Send it, then open it from another account or your phone. This turns green when the open arrives.");
  pollForTestOpen();
});

// ---------- Save ----------

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const before = await getSettings();
  const next = read();
  // Opens from before the switch-on never notify.
  if (next.notifications && !before.notifications) next.notificationsSince = new Date().toISOString();
  const saved = await saveSettings(next);
  const days = Number(field("retentionDays").value);
  if (days && days !== loadedRetention) {
    try {
      await setRetentionDays(saved, days);
      loadedRetention = days;
    } catch {
      say(out("saveResult"), "Saved here, but the Worker's retention couldn't be updated. Check the tracker is reachable.", true);
      void refreshChecklist();
      return;
    }
  }
  say(out("saveResult"), "Saved.");
  void refreshChecklist();
});

document.querySelector("#test")!.addEventListener("click", async () => {
  say(out("testResult"), "Checking…");
  const settings = await saveSettings(read());
  const problem = await checkTracker(settings);
  say(out("testResult"), problem ? `Not working: ${problem}` : "Tracker reachable, secret valid.", Boolean(problem));
  void refreshChecklist();
});

// ---------- Gmail ----------

const gmailStatus = out("gmailStatus");
const gmailButton = document.querySelector<HTMLButtonElement>("#gmailConnect")!;

function showGmail(state: GmailState): void {
  say(
    gmailStatus,
    state.status === "connected"
      ? `Connected as ${state.address}.`
      : state.status === "reconnect"
        ? "Access expired or was revoked. Reconnect to keep checking replies."
        : "Not connected.",
  );
  gmailButton.textContent = state.status === "connected" ? "Reconnect" : state.status === "reconnect" ? "Reconnect Gmail" : "Connect Gmail";
}

gmailButton.addEventListener("click", async () => {
  say(gmailStatus, "Waiting for Google…");
  const state = await send<GmailState | undefined>({ type: "gmail-connect" });
  if (state) {
    showGmail(state);
    void refreshChecklist();
  } else say(gmailStatus, "Couldn't connect. Check the OAuth client ID in extension/local.config.json (see docs/setup-guide.md).", true);
});

// ---------- Privacy ----------

document.querySelector("#deleteLocal")!.addEventListener("click", async () => {
  if (!confirm("Delete all emails, opens and notes stored in this browser? Settings are kept. This can't be undone.")) return;
  await db.clearAll();
  say(out("privacyResult"), "Local data deleted.");
  void refreshChecklist();
});

document.querySelector("#deleteWorker")!.addEventListener("click", async () => {
  if (!confirm("Delete every open event and token stored on your Worker? Your local dashboard data is kept. This can't be undone.")) return;
  try {
    await deleteAllWorkerEvents(await getSettings());
    say(out("privacyResult"), "Worker events deleted.");
  } catch {
    say(out("privacyResult"), "Couldn't reach the Worker. Nothing was deleted.", true);
  }
});

// ---------- Start ----------

async function start() {
  document.querySelector("#extensionId")!.textContent = chrome.runtime.id;
  await applyPrefill();
  await load();
  showGmail(await getGmailState());
  const facts = await refreshChecklist();
  if (facts.worker === "ok") {
    try {
      loadedRetention = await getRetentionDays(await getSettings());
      field("retentionDays").value = String(loadedRetention);
    } catch {
      /* leave blank: retention isn't editable until the Worker answers */
    }
  }
}
void start();
