# Cold Email Tracker — grilling decisions (2026-10-28)

Base PRD: "Cold Email Open Tracker — PRD" (Claude Doc, 2026-10-20)
(base PRD: private, not included)
These decisions override the PRD where they conflict.

## Decisions

| # | Topic | Decision | Overrides PRD? |
|---|-------|----------|----------------|
| 1 | Send path | **Chrome extension (MV3, loaded unpacked)** on mail.google.com. Adds the pixel when Send / Ctrl+Enter is pressed. Desktop Chrome only. The local FastAPI "Send tracked" app is **dropped**. | Yes (PRD made the extension v2) |
| 2 | Click tracking | **Not in v1.** v2: preset tracked links (resume, portfolio) are added in the dashboard and get a short redirect URL. Attachments can't be tracked; host the resume as a link instead. | Same as PRD for v1 |
| 3 | Dashboard + data | **Extension page** opened from the toolbar icon (no server). Recipient data in `chrome.storage.local` / IndexedDB. Export/Import as JSON + CSV. | Yes (PRD used local SQLite + FastAPI) |
| 4 | Pixel host | **Free `*.workers.dev` to start**; custom subdomain later (only new emails would use it). Cloudflare Worker + D1 holds only tokens + open events. | Same |
| 5 | Replies + bounces | **Gmail API, read-only** via `chrome.identity` (Google Cloud project in Testing mode, single user). Check tracked threads for replies; search mailer-daemon/postmaster for bounces. | Same idea, new mechanism |
| 6 | Tagging | **Auto at send, edit later in the dashboard.** Company guessed from the recipient's domain; variant = subject line; role is edited in the dashboard. No extra UI in compose. | Yes (PRD tagged before sending) |
| 7 | Tracking scope | **On by default**, with a per-email toggle next to Send plus a "never track" list of domains/addresses. | New |
| 8 | Deliverability v1 | **Health panel** (7-day bounce rate, Gmail open-rate drop warning, stale emails after 72h) + **seed tests**. Pre-send lint and the daily cap are **deferred**. | Partly |

## Extension risks to design for (agreed)
- Gmail's page structure changes → keep all selectors in one module; if injection fails, the email still sends but untracked, and the extension shows a "not tracked" warning.
- Worker unreachable → send anyway, untracked, with a warning (fail open).
- Plain-text compose mode → can't track; warn.
- Own views of the Sent copy → the extension suppresses those opens (better than a 3-min grace window).
- Follow-ups → remove old pixels from quoted text; each touch in a thread gets a fresh token.
- Forwards → opens by other people get counted; can't be avoided.

## Kept from PRD
Open classification (human / automated / self / uncertain), the token format, the Worker API shape, the privacy rules (no recipient data, IP hash only), status precedence Bounced > Replied > Opened > Opened (uncertain) > Not opened.

## Open
- Dashboard UI: model it on a competitor (Mailsuite/Mailtrack style). Do this in the design phase (`/design-grill`), since the user wants UI/UX later.
- Seed accounts to use (second Gmail, Outlook.com?).

## After the first live Gmail test (2026-10-28)

Agreed in grilling. These override the spec where they conflict.

**Fix now (small, no spec):**
1. **Open rule.** Decide by *who* fetched the image, not *when*. GoogleImageProxy opens count as human immediately, unless they fall within ±90 s of a self-view. Drop the 3-minute self grace window. The 60 s scanner window applies only to non-Gmail fetches (scanner ASNs/orgs). Accepted blind spot: viewing my own Sent copy in the Gmail phone app counts as an open (fixed manually, see "That was me").
2. **Updates.** The dashboard polls every 15 s while visible; the background polls every 1 min. Expected use is about 3.5k requests/day against the free plan's 100k, so $0.
3. **Own-view icon.** A "mirror" mark (an oval reflecting a small dot) in a faint stamp for self views. Scanner/automated opens keep the faint "—".
4. **Empty fields.** Show blank cells, not "No company".
5. **Blank To/subject bug.** Sending a draft reopened from Drafts recorded `to: []` and `subject: ""`. Inspect the live Gmail compose DOM (Claude in Chrome, test draft only, read only), then fix `extension/src/content/gmail-dom.ts`.

**Spec next (dashboard v1.1):**
- "Opened by <recipient>" as a sub-line under Opened. With several recipients: "by one of N recipients".
- An open count ("Opened 3 times").
- A "Columns" button to toggle Company, Subject, First open and Last activity. Choices are remembered.
- Filters in a raised band with a hairline under it; the table header is sticky.
- A "That was me" hover action on each timeline open. It reclassifies that open as self and saves the override, with Undo. A Settings tip explains the phone-app blind spot.

**Add to slice 8 (Gmail API sync):**
- Tag the reply client ("Replied via Superhuman": Superhuman replies carry a "Sent via Superhuman" signature, confirmed in a real reply).
- Backfill a missing To/subject from the matched sent message.
- Tag opens by mail app once real events show the patterns.

**Out:**
- AI-reader detection: AI summaries read text on the server and never load images, so they can't be detected.
- Forward detection: Gmail's proxy hides the device, so a hint would usually be wrong.

## Link and resume tracking (2026-11-05)

- **No redirect links on workers.dev.** A shared workers.dev domain hurts spam scoring. Loom and Google Docs links stay untouched; use Loom's own view stats and the Doc's view history.
- **Resume stays a PDF attachment, untracked.**
- **Portfolio (later):** no redirect. Append an opaque per-email token to the link on the portfolio's own domain (`?r=<token>`). The portfolio page sends a visit beacon to the Worker, tied to that email. No PII in the URL. A custom tracking domain is only needed if redirects come back.
- **Not possible:** knowing who "logged in" from an email. A visit can only be tied to the email/recipient token, not to an identity.
- Reverses nothing in `CLAUDE.md`: "no click tracking or link rewriting in v1" still holds.
