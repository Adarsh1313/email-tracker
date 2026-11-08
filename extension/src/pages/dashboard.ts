// Dashboard page: the Emails view (table, filters, detail panel, live updates).
import { loadDemoData } from "../demo";
import {
  exactTimeShort,
  filterRows,
  gmailUrl,
  openCountLabel,
  repliedLine,
  openedBy,
  relativeTime,
  sortRows,
  timelineOf,
  type EmailFilter,
  type SortKey,
  type StatusFilter,
} from "../core/emails-view";
import { buildRows, type EmailRow } from "../core/rows";
import type { RoleType, Status, TrackedEmail } from "../core/types";
import { getColumns, saveColumns, type ColumnPrefs } from "../columns";
import { db } from "../db";
import { getGmailState, type GmailState } from "../gmail";
import { send, type DataChanged } from "../messages";
import { getSettings } from "../settings";

type Mark = Status | "self";

const LABEL: Record<Mark, string> = {
  not_opened: "Not opened",
  opened: "Opened",
  opened_uncertain: "Opened (uncertain)",
  replied: "Replied",
  bounced: "Bounced",
  untracked: "Untracked",
  self: "Your own view",
};
const MARK: Record<Mark, string> = {
  not_opened: "m-check",
  opened: "m-double",
  opened_uncertain: "m-double",
  replied: "m-reply",
  bounced: "m-cross",
  untracked: "m-dash",
  self: "m-mirror",
};
const CHIPS: [StatusFilter, string][] = [
  ["all", "All"],
  ["follow_up", "Needs follow-up"],
  ["opened", "Opened"],
  ["replied", "Replied"],
  ["not_opened", "Not opened"],
  ["bounced", "Bounced"],
];
const DEFAULT_FILTER: EmailFilter = { status: "all", role: "any", rangeDays: null, search: "" };
const POLL_MS = 15_000;
const TOAST_MS = 6000;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const tbody = $("rows");
const panel = $("panel");
const chips = $("statusChips");
const indicator = chips.querySelector<HTMLElement>(".indicator")!;

let rows: EmailRow[] = [];
let followUpDays = 3;
let loaded = false;
let filter: EmailFilter = { ...DEFAULT_FILTER };
let sortKey: SortKey = "sent";
let selectedId: string | null = null;
let lastStatus = new Map<string, Status>();
let loadSeq = 0;
let lastTableHTML = "";
/** Rows that changed recently, until when (ms): they keep the wash (and the landing stamp) across re-renders. */
const liveUntil = new Map<string, number>();
const landingUntil = new Map<string, number>();

const tokenMs = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function stamp(status: Mark, landing = false): string {
  return `<span class="stamp${landing ? " is-landing" : ""}" data-status="${status}" role="img" aria-label="${LABEL[status]}"><svg aria-hidden="true"><use href="#${MARK[status]}"/></svg></span>`;
}

function exactTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function timeHTML(iso: string | null): string {
  if (!iso) return '<span class="faint">—</span>';
  const now = Date.now();
  return `<time datetime="${esc(iso)}" title="${esc(exactTime(iso))}">${relativeTime(iso, now)}<small>${exactTimeShort(iso, now)}</small></time>`;
}

// ---------- Data ----------

async function load(): Promise<void> {
  // Loads overlap (sync, data-changed, saves); only the newest result is applied.
  const seq = ++loadSeq;
  const [emails, opens, selfViews, overrides, settings] = await Promise.all([
    db.allEmails(), db.allOpens(), db.allSelfViews(), db.overriddenOpenIds(), getSettings(),
  ]);
  if (seq !== loadSeq) return;
  followUpDays = settings.followUpDays;
  const next = buildRows(emails, opens, selfViews, undefined, overrides);
  if (loaded) {
    const now = Date.now();
    for (const r of next) {
      const prev = lastStatus.get(r.email.id);
      if (prev === r.status) continue;
      liveUntil.set(r.email.id, now + tokenMs("--duration-confirm"));
      if (prev !== undefined) landingUntil.set(r.email.id, now + tokenMs("--duration-bleed"));
    }
  }
  lastStatus = new Map(next.map((r) => [r.email.id, r.status]));
  rows = next;
  loaded = true;
  render();
}

// ---------- Table ----------

function placeIndicator(animate: boolean): void {
  const active = chips.querySelector<HTMLElement>('[aria-checked="true"]');
  if (!active) return;
  indicator.classList.toggle("no-anim", !animate);
  indicator.style.width = `${active.offsetWidth}px`;
  indicator.style.height = `${active.offsetHeight}px`;
  indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
}

function renderChips(now: number): void {
  for (const chip of chips.querySelectorAll<HTMLButtonElement>(".chip")) {
    const status = chip.dataset.status as StatusFilter;
    chip.setAttribute("aria-checked", String(status === filter.status));
    chip.querySelector(".count")!.textContent = String(filterRows(rows, { ...filter, status }, now, followUpDays).length);
  }
  // The first placement jumps; later filter changes slide.
  placeIndicator(indicator.style.width !== "");
}

const isLive = (id: string, now: number) => (liveUntil.get(id) ?? 0) > now;
const isLanding = (id: string, now: number) => (landingUntil.get(id) ?? 0) > now;

/** "by priya@acme.io · 3 times" under Opened; nothing for other statuses. */
function statusSubline(row: EmailRow): string {
  const parts = [openedBy(row), repliedLine(row), openCountLabel(row.openCount)].filter(Boolean);
  return parts.length ? `<small>${esc(parts.join(" · "))}</small>` : "";
}

function rowHTML(row: EmailRow, now: number): string {
  const { email } = row;
  const id = esc(email.id);
  const landing = isLanding(email.id, now);
  const to = email.to.join(", ");
  return `<tr data-id="${id}" tabindex="0" aria-selected="${email.id === selectedId}"${isLive(email.id, now) ? ' class="is-live"' : ""}>
    <td><span class="status">${stamp(row.status, landing)}<span class="status-text"><span class="label">${LABEL[row.status]}</span>${statusSubline(row)}</span></span></td>
    <td class="who">${esc(to)}<small>${esc(email.company)}</small></td>
    <td class="subject">${esc(email.subject || "(no subject)")}${email.seedTest ? '<span class="seed">Seed test</span>' : ""}</td>
    <td class="time">${timeHTML(email.sentAt)}</td>
    <td class="time">${timeHTML(row.firstOpenAt)}</td>
    <td class="time">${timeHTML(row.lastActivityAt)}</td>
    <td class="actions"><span class="row-flex">
      <a class="btn btn-icon" href="${esc(gmailUrl(email))}" target="_blank" rel="noopener" aria-label="Open in Gmail"><svg class="icon"><use href="#i-external"/></svg></a>
      <button type="button" class="btn btn-icon" data-delete aria-label="Delete"><svg class="icon"><use href="#i-trash"/></svg></button>
    </span></td>
  </tr>`;
}

function render(): void {
  const now = Date.now();
  renderChips(now);
  const visible = sortRows(filterRows(rows, filter, now, followUpDays), sortKey);

  // Only touch the rows when they actually changed, so hover and running animations survive polls.
  const html = visible.map((row) => rowHTML(row, now)).join("");
  if (html !== lastTableHTML) {
    lastTableHTML = html;
    // Re-rendering replaces the rows; keep keyboard focus on the same email.
    const focusedId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("#rows tr")?.dataset.id;
    tbody.innerHTML = html;
    if (focusedId) rowElement(focusedId)?.focus();
  }
  for (const tr of tbody.querySelectorAll<HTMLElement>("tr.is-live")) {
    setTimeout(() => tr.classList.remove("is-live"), (liveUntil.get(tr.dataset.id!) ?? now) - now);
  }

  $("empty").hidden = rows.length > 0;
  $("noMatch").hidden = rows.length === 0 || visible.length > 0;
  if (selectedId) fillPanel(false);
  for (const [id, until] of liveUntil) if (until <= now) liveUntil.delete(id);
  for (const [id, until] of landingUntil) if (until <= now) landingUntil.delete(id);
}

function renderSkeleton(): void {
  const cell = (size: string) => `<td><div class="skeleton ${size}"></div></td>`;
  tbody.innerHTML = Array.from({ length: 5 }, () =>
    `<tr class="is-skeleton" aria-hidden="true"><td><div class="skeleton square"></div></td>${cell("medium")}${cell("long")}${cell("short")}${cell("short")}${cell("short")}<td></td></tr>`,
  ).join("");
}

// ---------- Side panel ----------

function rowById(id: string): EmailRow | undefined {
  return rows.find((r) => r.email.id === id);
}

function rowElement(id: string): HTMLElement | null {
  return tbody.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(id)}"]`);
}

function fillPanel(resetForm: boolean): void {
  const row = selectedId ? rowById(selectedId) : undefined;
  if (!row) return closePanel(false);
  const { email } = row;
  $("pCompany").textContent = email.company;
  $("pTo").textContent = email.to.join(", ");
  $("pSubject").textContent = email.subject || "(no subject)";
  const when = row.firstOpenAt ? ` · first opened ${relativeTime(row.firstOpenAt, Date.now())}` : "";
  $("pStatus").innerHTML = `${stamp(row.status, isLanding(email.id, Date.now()))}<span class="label">${LABEL[row.status]}${when}</span>`;
  $("pTimeline").innerHTML = timelineOf(row)
    .map((item) => {
      // Any open not already counted as me can be marked as mine (e.g. a phone-app read of my Sent copy).
      const mine =
        item.openId !== undefined && item.mark !== "self"
          ? `<button type="button" class="btn btn-ghost mine" data-open-id="${item.openId}">That was me</button>`
          : "<span></span>";
      return `<li>${stamp(item.mark)}<span${item.faded ? ' class="faded"' : ""}>${esc(item.label)}</span>${mine}${timeHTML(item.ts)}</li>`;
    })
    .join("");
  $<HTMLAnchorElement>("pGmail").href = gmailUrl(email);
  if (resetForm) {
    const form = $<HTMLFormElement>("tags");
    (form.elements.namedItem("company") as HTMLInputElement).value = email.company;
    (form.elements.namedItem("role") as HTMLSelectElement).value = email.role;
    (form.elements.namedItem("variant") as HTMLInputElement).value = email.variant;
    $("saveTags").classList.remove("is-confirmed");
  }
}

function markSelected(): void {
  for (const tr of tbody.querySelectorAll<HTMLElement>("tr[data-id]")) {
    tr.setAttribute("aria-selected", String(tr.dataset.id === selectedId));
  }
}

function openPanel(id: string): void {
  const switching = selectedId !== id;
  selectedId = id;
  fillPanel(switching);
  markSelected();
  panel.classList.add("is-open");
  panel.setAttribute("aria-hidden", "false");
}

function closePanel(restoreFocus = true): void {
  const id = selectedId;
  selectedId = null;
  panel.classList.remove("is-open");
  panel.setAttribute("aria-hidden", "true");
  markSelected();
  if (restoreFocus && id) rowElement(id)?.focus();
}

let confirmTimer: ReturnType<typeof setTimeout> | undefined;

async function saveTags(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  // Re-read the record: the background may have updated it since the last render.
  const email = selectedId ? await db.getEmail(selectedId) : undefined;
  if (!email) return;
  const data = new FormData(event.target as HTMLFormElement);
  await db.putEmail({
    ...email,
    company: String(data.get("company") ?? "").trim(),
    role: String(data.get("role") ?? "") as RoleType,
    variant: String(data.get("variant") ?? "").trim(),
  });
  const button = $("saveTags");
  clearTimeout(confirmTimer);
  button.classList.remove("is-confirmed");
  void button.offsetWidth; // restart the confirm animation
  button.classList.add("is-confirmed");
  confirmTimer = setTimeout(() => button.classList.remove("is-confirmed"), tokenMs("--duration-confirm"));
  await load();
}

// ---------- Delete with undo ----------

function toast(message: string, action?: { label: string; run: () => void }): void {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.append(message);
  let timer: ReturnType<typeof setTimeout>;
  const dismiss = () => {
    clearTimeout(timer);
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), tokenMs("--duration-exit") + 50);
  };
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-ghost";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      action.run();
      dismiss();
    });
    el.append(button);
  }
  $("toastHost").append(el);
  requestAnimationFrame(() => el.classList.add("is-in"));
  timer = setTimeout(dismiss, TOAST_MS);
}

async function deleteEmail(id: string): Promise<void> {
  const row = rowById(id);
  if (!row) return;
  const email: TrackedEmail = row.email;
  if (selectedId === id) closePanel(false);
  await db.deleteEmail(id);
  await load();
  toast(`Deleted the email to ${email.to[0] ?? "nobody"}.`, {
    label: "Undo",
    run: () => void db.putEmail(email).then(load),
  });
}

async function markAsMe(openId: number): Promise<void> {
  await db.addOverride(openId);
  await load();
  toast("Marked that open as you.", { label: "Undo", run: () => void db.removeOverride(openId).then(load) });
}

// ---------- Sync ----------

let syncing = false;

function setBanner(html: string | null): void {
  $("banner").hidden = html === null;
  if (html !== null) $("bannerText").innerHTML = html;
}

/** Background checks stay quiet; only a click shows the busy button. */
async function sync(showBusy = false): Promise<void> {
  if (syncing) return;
  syncing = true;
  const button = $<HTMLButtonElement>("sync");
  const label = button.querySelector("span")!;
  const icon = button.querySelector("svg")!;
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  if (showBusy) {
    button.disabled = true;
    icon.replaceWith(spinner);
    label.textContent = "Checking";
  }
  try {
    const settings = await getSettings();
    if (!settings.trackerHost || !settings.apiSecret) {
      setBanner('The tracker isn\'t set up, so new emails won\'t be tracked. Add the tracker host and API secret in <a href="settings.html">Settings</a>.');
    } else {
      const stored = await send<number | undefined>({ type: "sync-now" });
      if (stored === undefined) setBanner("Couldn't reach the tracker. Opens will update once it's back.");
      else {
        const gmail = await getGmailState();
        setBanner(
          gmail.status === "reconnect"
            ? 'Gmail access expired, so replies and bounces aren\'t being checked. <button type="button" class="link" data-action="gmail-connect">Reconnect Gmail</button>'
            : null,
        );
        $("syncNote").textContent = `Checked at ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
      }
    }
  } catch {
    setBanner("Couldn't reach the extension's background worker. Reload the page.");
  } finally {
    if (showBusy) {
      spinner.replaceWith(icon);
      label.textContent = "Check now";
    }
    button.disabled = false;
    syncing = false;
  }
  await load();
}

// ---------- Wiring ----------

function syncControls(): void {
  $<HTMLInputElement>("search").value = filter.search;
  $<HTMLSelectElement>("role").value = filter.role;
  $<HTMLSelectElement>("range").value = filter.rangeDays === null ? "" : String(filter.rangeDays);
}

chips.insertAdjacentHTML(
  "beforeend",
  CHIPS.map(([status, label]) => `<button type="button" class="chip" role="radio" aria-checked="false" data-status="${status}">${label} <span class="count">0</span></button>`).join(""),
);
chips.addEventListener("click", (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>(".chip");
  if (!chip) return;
  filter.status = chip.dataset.status as StatusFilter;
  render();
});
$("search").addEventListener("input", (e) => {
  filter.search = (e.target as HTMLInputElement).value;
  render();
});
$("role").addEventListener("change", (e) => {
  filter.role = (e.target as HTMLSelectElement).value as RoleType | "any";
  render();
});
$("range").addEventListener("change", (e) => {
  const v = (e.target as HTMLSelectElement).value;
  filter.rangeDays = v ? Number(v) : null;
  render();
});
$("sort").addEventListener("change", (e) => {
  sortKey = (e.target as HTMLSelectElement).value as SortKey;
  render();
});
$("clearFilters").addEventListener("click", () => {
  filter = { ...DEFAULT_FILTER };
  syncControls();
  render();
});

tbody.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const tr = target.closest<HTMLElement>("tr[data-id]");
  if (!tr) return;
  if (target.closest("[data-delete]")) void deleteEmail(tr.dataset.id!);
  else if (!target.closest(".actions")) openPanel(tr.dataset.id!);
});
tbody.addEventListener("keydown", (e) => {
  const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-id]");
  if (tr && e.target === tr && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    openPanel(tr.dataset.id!);
  }
});
$("closePanel").addEventListener("click", () => closePanel());
$("pTimeline").addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>("[data-open-id]");
  if (button) void markAsMe(Number(button.dataset.openId));
});
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (columnsOpen()) {
    setColumnsMenu(false);
    $("columnsButton").focus();
  } else if (selectedId) closePanel();
});

// ---------- Columns ----------

const table = document.querySelector<HTMLTableElement>(".ledger")!;
let columns: ColumnPrefs;

function applyColumns(): void {
  for (const [key, on] of Object.entries(columns) as [keyof ColumnPrefs, boolean][]) {
    table.classList.toggle(`hide-${key}`, !on);
    $<HTMLInputElement>(`col-${key}`).checked = on;
  }
}

const columnsOpen = () => $("columnsButton").getAttribute("aria-expanded") === "true";

function setColumnsMenu(open: boolean): void {
  $("columnsButton").setAttribute("aria-expanded", String(open));
  $("columnsMenu").classList.toggle("is-open", open);
}

$("columnsButton").addEventListener("click", () => setColumnsMenu(!columnsOpen()));
$("columnsMenu").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  const key = input.id.replace("col-", "") as keyof ColumnPrefs;
  columns = { ...columns, [key]: input.checked };
  applyColumns();
  void saveColumns(columns);
});
document.addEventListener("click", (e) => {
  if (columnsOpen() && !(e.target as HTMLElement).closest(".columns")) setColumnsMenu(false);
});
void getColumns().then((prefs) => {
  columns = prefs;
  applyColumns();
});

// The header sticks just under the filter band, whatever height the band wraps to.
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty("--band-height", `${entry.borderBoxSize[0].blockSize}px`);
}).observe($("filterBand"));
$<HTMLFormElement>("tags").addEventListener("submit", (e) => void saveTags(e));
$("pDelete").addEventListener("click", () => selectedId && void deleteEmail(selectedId));
$("sync").addEventListener("click", () => void sync(true));
$("bannerText").addEventListener("click", async (e) => {
  if (!(e.target as HTMLElement).closest('[data-action="gmail-connect"]')) return;
  if (await send<GmailState | undefined>({ type: "gmail-connect" })) void sync(true);
});

chrome.runtime.onMessage.addListener((msg: DataChanged | { type: string }) => {
  if (msg.type === "data-changed") void load();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void sync();
});
setInterval(() => {
  if (document.visibilityState === "visible") void sync();
}, POLL_MS);
addEventListener("resize", () => placeIndicator(false));
void document.fonts.ready.then(() => placeIndicator(false));

renderSkeleton();
void loadDemoData()
  .then(() => load())
  .then(() => sync());
