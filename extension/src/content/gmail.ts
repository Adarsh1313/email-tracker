// Gmail content script: tracking toggle, send interception, self-views.
import { normalizeSubject, pickChip, type ChipEntry } from "../core/chips";
import { trackerTokenFromSrc } from "../core/pixel";
import { send, type ComposeState, type ContentConfig, type PrepareSendResult } from "../messages";
import * as gmail from "./gmail-dom";

let config: ContentConfig = { trackerHost: "" };

/** Per-compose state, keyed by the compose root element. */
const trackingOff = new WeakSet<HTMLElement>();
const released = new WeakSet<HTMLElement>();
const inFlight = new WeakSet<HTMLElement>();
/** Composes armed to "send separately" (prototype, off by default). */
const splitArmed = new WeakSet<HTMLElement>();

// ---- Toast -----------------------------------------------------------------

function toast(text: string) {
  const el = document.createElement("div");
  el.className = "et-toast";
  el.setAttribute("role", "status");
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("et-toast--in"));
  setTimeout(() => {
    el.classList.remove("et-toast--in");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  }, 4000);
}

const FAILURE_TEXT: Record<string, string> = {
  "tracker-unreachable": "Sent without tracking: the tracker didn't respond.",
  "not-set-up": "Sent without tracking: set up the tracker in Email Tracker settings.",
  "no-body": "Sent without tracking: couldn't find the email body.",
};

// ---- Toggle ----------------------------------------------------------------

async function renderToggle(compose: gmail.Compose) {
  let toggle = compose.root.querySelector<HTMLButtonElement>(".et-toggle");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "et-toggle";
    toggle.setAttribute("role", "switch");
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (trackingOff.has(compose.root)) trackingOff.delete(compose.root);
      else trackingOff.add(compose.root);
      renderToggle(compose);
    });
    gmail.toggleAnchor(compose).after(toggle);
    const split = document.createElement("button");
    split.type = "button";
    split.className = "et-split";
    split.setAttribute("role", "switch");
    split.setAttribute("aria-checked", "false");
    split.textContent = "Separate";
    split.title = "Experimental: send a separate copy to each recipient, so you can see who opened (click to arm)";
    split.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const armed = !splitArmed.has(compose.root);
      if (armed) splitArmed.add(compose.root);
      else splitArmed.delete(compose.root);
      split.setAttribute("aria-checked", String(armed));
    });
    toggle.after(split);
  }
  const state = await send<ComposeState>({ type: "compose-state", to: gmail.recipients(compose) });
  const on = state.track && !trackingOff.has(compose.root);
  toggle.setAttribute("aria-checked", String(on));
  toggle.dataset.reason = state.track ? (on ? "on" : "off") : state.reason;
  toggle.title =
    state.reason === "never-track"
      ? "Not tracked: a recipient is on your never-track list"
      : state.reason === "not-set-up"
        ? "Not tracked: set up the tracker in Email Tracker settings"
        : on
          ? "Tracking on (click to send this one untracked)"
          : "Tracking off for this email";
  toggle.setAttribute("aria-label", toggle.title);
}

// ---- Send interception -----------------------------------------------------

async function prepareAndSend(compose: gmail.Compose) {
  if (inFlight.has(compose.root)) return;
  inFlight.add(compose.root);
  const to = gmail.recipients(compose);
  const subject = gmail.subject(compose);
  if (splitArmed.has(compose.root) && to.length >= 2) {
    const opened = await send<"all" | "partial" | "none">({ type: "start-split", to, subject, bodyText: gmail.bodyText(compose) }).catch(() => "none" as const);
    if (opened === "all" || opened === "partial") {
      inFlight.delete(compose.root);
      toast(
        opened === "all"
          ? `Opened ${to.length} separate drafts. Re-attach files, check each, and send them. This original was not sent.`
          : "Only some separate drafts opened. This original was not sent: finish the rest by hand.",
      );
      return;
    }
    // Fail open: fall through to a normal single send.
    toast("Couldn't split this email, so it was sent as one (max 5 recipients).");
  }
  const sentAt = new Date().toISOString();
  let token: string | null = null;
  let failure: string | null = null;
  let result: PrepareSendResult | undefined;

  try {
    result = await send<PrepareSendResult>({
      type: "prepare-send",
      to,
      subject,
      sentAt,
      trackingOn: !trackingOff.has(compose.root),
    });
    if (!result) {
      failure = "tracker-unreachable";
    } else if (result.ok) {
      if (compose.body.isConnected) {
        gmail.removePixels(compose, (src) => trackerTokenFromSrc(src, config.trackerHost) !== null);
        gmail.appendPixel(compose, result.pixelUrl);
        token = result.token;
      } else {
        failure = "no-body";
      }
    } else if (result.reason !== "off" && result.reason !== "never-track") {
      failure = result.reason;
    }
    // Recording can fail independently; opens still sync and can be matched later.
    await send({ type: "record-send", record: { token, to, subject, sentAt, seedTest: result?.seedTest ?? false, groupId: result?.ok ? result.groupId : undefined } });
  } catch (err) {
    if (!token) failure ??= "tracker-unreachable";
    console.warn("[email-tracker]", err);
  } finally {
    // Fail open: the email always goes out.
    released.add(compose.root);
    inFlight.delete(compose.root);
    gmail.clickSend(compose);
    // If Gmail refuses the send (say, no recipients), the next attempt is held again.
    setTimeout(() => released.delete(compose.root), 1000);
    if (failure) toast(FAILURE_TEXT[failure] ?? FAILURE_TEXT["tracker-unreachable"]);
  }
}

function holdBack(e: Event, compose: gmail.Compose) {
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === "click" || e.type === "keydown") prepareAndSend(compose);
}

for (const type of ["mousedown", "mouseup", "click"] as const) {
  document.addEventListener(
    type,
    (e) => {
      const button = gmail.isSendButton(e.target as Element);
      if (!button || !e.isTrusted) return;
      const compose = gmail.composeForElement(button);
      if (!compose || released.has(compose.root)) return;
      holdBack(e, compose);
    },
    true,
  );
}

document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || !e.isTrusted) return;
    const compose = gmail.composeForElement(e.target as Element);
    if (!compose || released.has(compose.root)) return;
    holdBack(e, compose);
  },
  true,
);

// ---- Self-views: me reading my own tracked emails --------------------------

const reported = new Map<string, number>();

function reportSelfViews() {
  if (!config.trackerHost) return;
  const now = Date.now();
  const tokens = gmail
    .threadImageSources()
    .map((src) => trackerTokenFromSrc(src, config.trackerHost))
    .filter((t): t is string => t !== null && now - (reported.get(t) ?? 0) > 60_000);
  if (!tokens.length) return;
  for (const t of tokens) reported.set(t, now);
  send({ type: "self-views", tokens: [...new Set(tokens)], ts: new Date(now).toISOString() });
}

// ---- Wiring ----------------------------------------------------------------

let scheduled = false;
function scan() {
  scheduled = false;
  for (const compose of gmail.findComposes()) {
    if (!compose.root.querySelector(".et-toggle")) renderToggle(compose);
  }
  for (const root of gmail.plainTextComposes()) {
    if (root.querySelector(".et-banner")) continue;
    const banner = document.createElement("span");
    banner.className = "et-banner";
    banner.setAttribute("role", "status");
    banner.textContent = "Not tracked: plain-text mode";
    banner.title = "Switch this email to rich text (⋮ → Plain text mode) to track it.";
    gmail.bannerAnchor(root).after(banner);
  }
  reportSelfViews();
  void renderChips();
}

// ---- Sent-list chips ---------------------------------------------------------

let chips: Record<string, ChipEntry[]> = {};
let chipsFetchedAt = 0;

/** Fails quiet: a missing row, a stale map or a message error just means no chips. */
async function renderChips() {
  try {
    const rows = gmail.sentListRows();
    if (!rows.length) return;
    if (Date.now() - chipsFetchedAt > 30_000) {
      chipsFetchedAt = Date.now();
      chips = (await send<Record<string, ChipEntry[]>>({ type: "sent-chips" })) ?? {};
    }
    for (const { subject, anchor, addresses } of rows) {
      const chip = pickChip(chips[normalizeSubject(subject)], addresses);
      const existing = anchor.parentElement?.querySelector<HTMLElement>(":scope > .et-chip");
      if (!chip) {
        existing?.remove();
        continue;
      }
      if (existing?.textContent === chip.text && existing.dataset.status === chip.status) continue;
      const el = existing ?? document.createElement("span");
      el.className = "et-chip";
      el.dataset.status = chip.status;
      el.textContent = chip.text;
      if (!existing) anchor.after(el);
    }
  } catch {
    /* never break Gmail */
  }
}

// Re-evaluate the toggle when recipients change (chips added/removed).
document.addEventListener(
  "focusout",
  (e) => {
    const compose = gmail.composeForElement(e.target as Element);
    if (compose) renderToggle(compose);
  },
  true,
);

// Pick up tracker changes made in settings without reloading Gmail.
chrome.storage.onChanged.addListener((changes) => {
  const host = (changes.settings?.newValue as { trackerHost?: unknown } | undefined)?.trackerHost;
  if (typeof host === "string") config = { trackerHost: host };
});

send<ContentConfig>({ type: "get-config" }).then((c) => {
  if (c) config = c;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(scan, 300);
  }).observe(document.body, { childList: true, subtree: true });
  scan();
});
