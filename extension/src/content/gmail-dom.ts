// Gmail adapter: every Gmail DOM selector lives here. Gmail changes its
// markup without notice; when tracking breaks, this is the file to fix.
// Selectors avoid localised text (aria-labels, tooltips) where possible.

const SEL = {
  /** Compose and reply bodies carry g_editable="true". */
  body: 'div[contenteditable="true"][g_editable="true"]',
  /** Send button (long-lived class names; tooltip as fallback). */
  send: 'div[role="button"].T-I.aoO, div[role="button"][data-tooltip^="Send"]',
  subjectInput: 'input[name="subjectbox"]',
  /** Hidden field in every compose's form, new or reopened from Drafts. */
  composeForm: 'input[name="composeid"]',
  /** Recipient chips in To/Cc/Bcc. */
  recipientChip: "[data-hovercard-id]",
  recipientInputs: 'input[name="to"], input[name="cc"], input[name="bcc"]',
  /** Subject heading of the open thread (for inline replies). */
  threadSubject: "h2.hP",
  /** Plain-text compose uses a textarea instead of the rich editor (unverified: check on a real compose). */
  plainTextBody: 'textarea[name="body"]',
  /** Rendered message bodies in an open thread (not compose). */
  messageBody: "div.a3s",
  /** Conversation list rows and their subject text (unverified: check on a real Sent list). */
  listRow: "tr.zA",
  listSubject: "span.bog",
  /** Recipient names in a Sent row carry the address in an email attribute (unverified). */
  listRecipient: "[email]",
} as const;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export interface Compose {
  root: HTMLElement;
  body: HTMLElement;
  sendButton: HTMLElement;
}

/**
 * The smallest ancestor of a compose body that holds its Send button and its
 * compose form (To and subject). A draft reopened from Drafts nests Send in an
 * inner table without the header, so Send alone isn't enough.
 */
function composeRoot(body: HTMLElement): HTMLElement | null {
  let sendOnly: HTMLElement | null = null;
  for (let el = body.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.querySelectorAll(SEL.body).length > 1) break;
    if (!el.querySelector(SEL.send)) continue;
    if (el.querySelector(SEL.composeForm)) return el;
    sendOnly ??= el;
  }
  return sendOnly;
}

export function findComposes(): Compose[] {
  const out: Compose[] = [];
  for (const body of document.querySelectorAll<HTMLElement>(SEL.body)) {
    const root = composeRoot(body);
    const sendButton = root?.querySelector<HTMLElement>(SEL.send);
    if (root && sendButton) out.push({ root, body, sendButton });
  }
  return out;
}

export function composeForElement(el: Element | null): Compose | null {
  if (!el) return null;
  return findComposes().find((c) => c.root.contains(el)) ?? null;
}

export function isSendButton(el: Element | null): HTMLElement | null {
  return (el?.closest<HTMLElement>(SEL.send)) ?? null;
}

export function recipients(compose: Compose): string[] {
  const found = new Set<string>();
  for (const chip of compose.root.querySelectorAll<HTMLElement>(SEL.recipientChip)) {
    const id = chip.getAttribute("data-hovercard-id") ?? "";
    if (id.includes("@")) found.add(id.toLowerCase());
  }
  for (const input of compose.root.querySelectorAll<HTMLInputElement>(SEL.recipientInputs)) {
    for (const m of input.value.match(EMAIL_RE) ?? []) found.add(m.toLowerCase());
  }
  return [...found];
}

export function subject(compose: Compose): string {
  const input = compose.root.querySelector<HTMLInputElement>(SEL.subjectInput);
  if (input?.value) return input.value;
  return document.querySelector(SEL.threadSubject)?.textContent?.trim() ?? "";
}

/** Removes our old pixels from the body, quoted text included. */
export function removePixels(compose: Compose, isOurs: (src: string) => boolean): void {
  for (const img of compose.body.querySelectorAll("img")) {
    if (isOurs(img.getAttribute("src") ?? "")) img.remove();
  }
}

export function appendPixel(compose: Compose, url: string): void {
  const img = document.createElement("img");
  img.src = url;
  img.width = 1;
  img.height = 1;
  img.alt = "";
  img.setAttribute("style", "display:block;border:0;width:1px;height:1px");
  compose.body.appendChild(img);
}

/** Replays a click on Send after we held it back. */
export function clickSend(compose: Compose): void {
  const opts = { bubbles: true, cancelable: true, view: window };
  compose.sendButton.dispatchEvent(new MouseEvent("mousedown", opts));
  compose.sendButton.dispatchEvent(new MouseEvent("mouseup", opts));
  compose.sendButton.dispatchEvent(new MouseEvent("click", opts));
}

/** Image sources in rendered messages of the open thread (excludes compose bodies). */
export function threadImageSources(): string[] {
  const srcs: string[] = [];
  for (const body of document.querySelectorAll<HTMLElement>(SEL.messageBody)) {
    if (body.closest(SEL.body)) continue;
    for (const img of body.querySelectorAll("img")) srcs.push(img.getAttribute("src") ?? "");
  }
  return srcs;
}

/** Where to put our toggle: just after the Send button's group. */
export function toggleAnchor(compose: Compose): HTMLElement {
  return compose.sendButton.parentElement ?? compose.sendButton;
}

/** Composes in plain-text mode: the pixel can't be added, so these send untracked. */
export function plainTextComposes(): HTMLElement[] {
  const roots: HTMLElement[] = [];
  for (const area of document.querySelectorAll<HTMLTextAreaElement>(SEL.plainTextBody)) {
    for (let el = area.parentElement; el && el !== document.body; el = el.parentElement) {
      if (el.querySelector(SEL.send)) {
        roots.push(el);
        break;
      }
    }
  }
  return roots;
}

/** Where to put the plain-text banner: just after the Send button's group. */
export function bannerAnchor(root: HTMLElement): HTMLElement {
  const send = root.querySelector<HTMLElement>(SEL.send);
  return send?.parentElement ?? root;
}

/**
 * Rows of Gmail's Sent list with their subject text and the element a chip goes
 * after. Anything unexpected yields no rows (and so no chips), never an error.
 */
export function sentListRows(): { subject: string; anchor: HTMLElement; addresses: string[] }[] {
  try {
    if (!/^#sent/.test(location.hash)) return [];
    const rows: { subject: string; anchor: HTMLElement; addresses: string[] }[] = [];
    for (const tr of document.querySelectorAll<HTMLElement>(SEL.listRow)) {
      const anchor = tr.querySelector<HTMLElement>(SEL.listSubject);
      const subject = anchor?.textContent?.trim();
      if (!anchor || !subject) continue;
      const addresses = [...tr.querySelectorAll<HTMLElement>(SEL.listRecipient)].map((el) => el.getAttribute("email") ?? "").filter((a) => a.includes("@"));
      rows.push({ subject, anchor, addresses });
    }
    return rows;
  } catch {
    return [];
  }
}

/** Plain text of a compose body, without our pixel or other images. */
export function bodyText(compose: Compose): string {
  return compose.body.innerText.trim();
}
