# Spec: Email Tracker v1

Status: ready-for-agent
Sources: `docs/decisions.md` (overrides the PRD), base PRD "Cold Email Open Tracker — PRD"

## Problem Statement

I send 20–30 cold emails a day (job applications, founders, hiring managers, recruiters). I write them as Gmail drafts, by hand or with Claude, review them, and click Send in Gmail on my desktop. After that I have no signal: I don't know whether an email was opened, ignored, bounced, or filtered to spam, or which subject lines work. Commercial trackers (Mailtrack, Streak, Mailsuite) add a visible signature or badge, require a paid plan for history, and send my recipient data to their servers. I want tracking that is invisible to recipients, fits how I already send, costs nothing, and keeps recipient data on my machine.

## Solution

A Chrome extension (loaded unpacked) that works inside Gmail on desktop. When I click Send, it quietly adds an invisible 1×1 tracking pixel to the email. I don't change how I write or send. A tiny free Cloudflare Worker serves the pixel and logs opens against random tokens; it never learns who I emailed. The extension's own dashboard page (opened from the toolbar icon) shows every tracked email with its status (Not opened, Opened, Opened (uncertain), Replied, Bounced) and its first-open time, plus simple stats by subject line, role and recipient mail provider, and a deliverability health panel. Replies and bounces come from read-only Gmail API access. All recipient data stays in the browser, with JSON/CSV export and import.

## User Stories

### Sending and tracking
1. As a sender, I want every email I send from Gmail web to be tracked automatically, so that I don't have to remember to turn tracking on for cold emails.
2. As a sender, I want tracking to work whether the draft was written by Claude, by hand, or pasted from elsewhere, so that every way I write is covered.
3. As a sender, I want tracking added when I click Send and when I press Ctrl+Enter / Cmd+Enter, so that every way of sending is covered.
4. As a sender, I want a small tracking toggle next to the Send button in each compose window, so that I can switch tracking off for a single email.
5. As a sender, I want the toggle to clearly show whether this email will be tracked, so that I'm never unsure before sending.
6. As a sender, I want a "never track" list of domains and addresses (family, my college, EU domains), so that those emails are never tracked even if I forget the toggle.
7. As a sender, I want the toggle to show "off" automatically when a recipient is on the never-track list, so that I can see why it's off.
8. As a sender, I want the pixel to be completely invisible in Gmail web, Gmail mobile and Outlook.com, so that recipients see nothing unusual.
9. As a sender, I want no footer, signature, badge or rewritten link added to my email, so that it looks exactly like a normal Gmail message.
10. As a sender, I want sending never to be blocked by the tracker, so that an outage or a Gmail page change never stops my email.
11. As a sender, I want a short "Sent without tracking" toast when the pixel couldn't be added or the tracker couldn't be reached, so that I know which emails have no data.
12. As a sender, I want untracked sends still recorded in the dashboard (marked Untracked), so that reply detection and my send history still include them.
13. As a sender, I want a warning when compose is in plain-text mode, so that I know that email can't be tracked.
14. As a sender, I want each follow-up in a thread to get its own pixel, so that each touch is tracked separately.
15. As a sender, I want old pixels removed from the quoted text when I reply or follow up, so that a recipient reading my follow-up doesn't count as opening the earlier email.
16. As a sender, I want emails to several recipients tracked as one email, so that the data model stays simple (per-recipient tracking is not needed for cold email).

### Open detection accuracy
17. As a sender, I want opening my own Sent copy to be ignored, so that I don't fool myself with fake opens.
18. As a sender, I want opens in the first minute after sending, or from security-scanner networks, classified as automated, so that scanners don't count as reads.
19. As a sender, I want Apple Mail privacy preloads classified as uncertain, so that I treat them with caution.
20. As a sender, I want Gmail-proxy opens classified as human, so that the most trustworthy signal is counted.
21. As a sender, I want a later human open to upgrade an email that only had an automated open, so that the status reflects the best evidence.
22. As a sender, I want a reply to count as opened even with no pixel event, so that blocked images don't hide engagement.
23. As a sender, I want the classification rules (scanner networks, user-agent patterns) in one editable table, so that I can tune them from real data in week 1.

### Replies and bounces
24. As a sender, I want to connect my Gmail once with read-only access, so that replies and bounces are detected automatically.
25. As a sender, I want each tracked email matched to its Gmail thread after sending, so that replies can be found.
26. As a sender, I want an email marked Replied when anyone other than me replies in its thread, so that I see my strongest signal.
27. As a sender, I want an email marked Bounced when a mailer-daemon or postmaster bounce mentions its recipient, so that I can fix bad addresses.
28. As a sender, I want reply and bounce checks to run in the background every few minutes while Chrome is open, so that the dashboard is current when I open it.
29. As a sender, I want a clear "Reconnect Gmail" prompt when the access token expires or is revoked, so that detection doesn't stop silently.

### Dashboard: emails
30. As a sender, I want to open the dashboard in a new tab with one click on the toolbar icon, so that it's always one click away.
31. As a sender, I want a chronological list of tracked emails showing recipient, company, subject, sent time, status and first open, so that I can scan everything quickly.
32. As a sender, I want status shown as distinct, readable chips (with the ✓ / ✓✓ language of read receipts), so that I can tell states apart at a glance.
33. As a sender, I want to filter by status, date range and role, and search by recipient, company or subject, so that I can find who to follow up with.
34. As a sender, I want to sort by sent time, first open or last activity, so that I can see recent engagement first.
35. As a sender, I want a "Needs follow-up" view (opened but not replied after N days, or stale), so that I know who to nudge next.
36. As a sender, I want to click an email and see a detail panel with its timeline of events (sent, each open with its classification, reply, bounce), so that I understand what happened.
37. As a sender, I want to edit company, role type and variant in the detail panel, so that my stats are accurate without slowing down sending.
38. As a sender, I want company pre-filled from the recipient's domain and variant pre-filled from the subject line, so that most rows need no editing.
39. As a sender, I want new opens to appear while the dashboard is open, with a subtle highlight on the changed row, so that I notice activity without refreshing.
40. As a sender, I want relative times ("2h ago") with exact times on hover, so that recent activity reads quickly.
41. As a sender, I want to open the email's Gmail thread from the dashboard, so that I can follow up straight away.
42. As a sender, I want to delete an email from tracking, so that I can remove tests and mistakes.
43. As a sender, I want an empty state that explains how to send my first tracked email, so that a fresh install isn't confusing.

### Dashboard: stats
44. As a sender, I want open rate and reply rate by variant (subject line), so that I can A/B test my writing.
45. As a sender, I want open and reply rate by role type (Founder / Hiring manager / Recruiter / Other), so that I know who responds.
46. As a sender, I want open rate by recipient mail provider (Gmail / Outlook / Apple / Other), so that I can discount providers where pixels are unreliable.
47. As a sender, I want weekly trends of sent, opened and replied counts, so that I can see whether things are improving.
48. As a sender, I want headline numbers (sent, open rate, reply rate, bounce rate) for the selected date range, so that I get the summary in one glance.
49. As a sender, I want small sample sizes flagged (for example n < 10), so that I don't over-read noise.

### Dashboard: deliverability health
50. As a sender, I want my 7-day bounce rate with a warning above 3%, so that I catch bad address guesses.
51. As a sender, I want a warning when my Gmail-recipient open rate falls by more than half against the trailing 2-week average, so that I spot possible spam placement.
52. As a sender, I want stale emails (sent 72h+ ago to Gmail recipients, with no open and no reply) listed as "ignored or filtered", so that I can judge deliverability.
53. As a sender, I want to mark a send as a seed test when it goes to my own seed addresses (set in settings), so that it's excluded from real stats.
54. As a sender, I want to record where each seed copy landed (Inbox / Promotions / Spam / Missing), so that I have a placement history for each template.
55. As a sender, I want a reminder to run a seed test when I start using a new subject or variant, so that I check placement whenever I change templates.

### Settings and data
56. As a sender, I want a settings page for the tracker URL, API secret, never-track list, seed addresses, follow-up window and Gmail connection, so that setup is in one place.
57. As a sender, I want a "Test tracker" button that checks the Worker is reachable and the secret is valid, so that I know setup worked.
58. As a sender, I want to export all data as JSON (full backup) and CSV (emails table), so that I don't lose history if the extension is removed.
59. As a sender, I want to import a JSON backup, so that I can move to a new laptop or Chrome profile.
60. As a sender, I want a README with step-by-step setup (Cloudflare, Google Cloud OAuth, loading unpacked), so that I can set it up again from nothing.

### Privacy
61. As a sender, I want the Worker to store only random tokens, send times and open metadata (user agent, network, country, IP hash), so that a breach reveals nobody's identity.
62. As a sender, I want the Worker's API protected by a bearer secret, so that nobody else can register tokens or read events.
63. As a sender, I want the pixel endpoint to always return the image (even for unknown tokens) and never redirect, so that it behaves like a plain image.

## Implementation Decisions

### Architecture
- Two deployables: a **Tracker Worker** (Cloudflare Worker + D1, `*.workers.dev`) and a **Chrome MV3 extension** (TypeScript, loaded unpacked, stable extension ID via a manifest `key` so the Google OAuth client keeps working).
- The extension has four parts:
  - **Gmail content script**: compose hooks, toggle UI, self-view detection.
  - **Background service worker**: token registration, polling, Gmail API sync, alarms.
  - **Dashboard page**: a full-tab extension page.
  - **Tracking core**: a pure TypeScript module with no Chrome or DOM dependencies.
- **Gmail adapter**: every Gmail DOM selector and every send-interception detail lives in one adapter module behind a small interface (find compose windows, get recipients/subject/body element, observe the Send intent, insert the toggle). When Gmail's markup changes, only this module is touched.
- **Storage**: recipient data lives in IndexedDB (emails, open events, seed results) behind a storage module. Settings live in `chrome.storage.local`. The Worker holds only tokens and opens.

### Tracker Worker API (unchanged from the PRD, renamed slightly)
- `GET /p/{token}.gif` → a 43-byte transparent GIF, `Content-Type: image/gif`, `Cache-Control: no-store, no-cache, must-revalidate, private`. Always 200, never a redirect, target < 100 ms. Known tokens log an open event (ts, user agent, `cf.asn`, `cf.asOrganization`, country, salted SHA-256 of the IP). Logging must not delay the response (`waitUntil`).
- `POST /api/tokens` `{token, sent_at}` → 201; idempotent on repeat.
- `GET /api/events?after={id}&limit={n}` → open events with id > `after`, oldest first (max 500), plus `next_after` to pass on the next call. An id cursor avoids timestamp ties.
- `GET /api/health` → 200 when the secret is valid (used by "Test tracker").
- `/api/*` requires `Authorization: Bearer {API_SECRET}`. Secrets: `API_SECRET`, `IP_SALT` (Wrangler secrets).
- D1 tables: `tokens(token PK, sent_at, created_at)`, `opens(id PK, token FK, ts, user_agent, asn, as_org, country, ip_hash)`.
- Tokens: 128-bit random, URL-safe base64 (22 characters), generated in the extension.

### Send flow (content script + background)
1. Intercept the Send click and Ctrl/Cmd+Enter in the capture phase for compose windows where tracking is on.
2. Generate a token. Ask the background to register it, with a hard timeout of about 1.5 s.
3. On success, remove any existing tracker pixels from the body (quoted text included), add the pixel `<img>` (1×1, empty alt, `display:block;border:0;width:1px;height:1px`) at the end of the body, then let the send continue.
4. On any failure (timeout, adapter can't find the body, plain-text mode), let the send continue untouched and show the "Sent without tracking" toast.
5. Either way, save an email record locally: token (or none), recipients, subject, sent_at, tracked flag, prefilled company/variant.
- Tracking scope: on by default. It is off when any recipient matches the never-track list, or when the user switches the per-compose toggle off. Sends whose recipients are all seed addresses are marked as seed tests.

### Self-open suppression
- When I open a thread in Gmail, the content script scans message images for tracker URLs (Gmail's proxy URL keeps the original URL after `#`), extracts the tokens and logs a self-view `{token, ts}`.
- The classifier marks any open within a short window of a self-view (default ±90 s) as `self`. There is no send grace window: opens are decided by *who* fetched the image, not *when* (decisions.md, after the first live test).
- Accepted blind spot: viewing my own Sent copy in the Gmail phone app logs no self-view, so it counts as an open; fixed by hand with "That was me" (`docs/specs/dashboard-v1-1.md`).
- Risk to verify in week 1: whether Gmail's proxy cache causes a recipient's real first open to be missed after I view my own copy.

### Tracking core (the main test seam): pure functions
- `newToken()`, `pixelUrl(host, token)`, `trackerTokenFromSrc(src, host)`: build pixels and recognise ours (direct or via Gmail's proxy). The Gmail adapter uses these to remove old pixels (quoted text included) and append the new one as DOM nodes, rather than rewriting the compose HTML.
- `classifyOpen(event, email, selfViews, rules)` → `human | automated | self | uncertain`, in this order: near a self-view → self; GoogleImageProxy UA → human (even right after sending); non-Gmail fetch < 60 s after send → automated; then scanner ASNs/orgs → automated and Apple/Microsoft networks → uncertain.
- `deriveStatus(email, events)` → `Bounced > Replied > Opened > Opened (uncertain) > Not opened`, plus `Untracked` when tracked=false and nothing stronger exists. A reply implies opened. A later human event upgrades an automated-only email.
- `matchThread(email, sentMessages)`: picks the Gmail sent message by recipient + subject + time proximity.
- `detectReply(thread, myAddress)` and `matchBounce(bounceMessage, emails)`.
- `computeStats(emails, range, groupBy)` and `computeHealth(emails, now)`: rates, small-sample flags, the bounce warning, the open-rate drop warning, the stale list.
- `prefillTags(recipient, subject)`: company from the domain (free-mail domains such as gmail.com → blank), variant = normalised subject.
- `providerFromMx(mxHosts)` → Gmail / Outlook / Apple / Other. MX records are fetched via DNS-over-HTTPS (domain only, cached per domain).

### Gmail API sync (background)
- `chrome.identity.getAuthToken` with the `gmail.readonly` scope only. OAuth client of type "Chrome extension" in a Google Cloud project in Testing mode, with me as the test user.
- Opens: pulled from the Worker every 1 min via `chrome.alarms` (`after` id cursor). The dashboard also syncs on open and polls every 15 s while visible (about 3.5k requests/day, well inside the free plan's 100k).
- Gmail API work runs every 5 min (a separate, slower alarm, to stay light on Gmail quota):
  - match unmatched emails to sent threads,
  - check matched threads for replies,
  - search `from:(mailer-daemon OR postmaster) newer_than:3d` for bounces.
- Added after the first live test:
  - **Reply client tag.** When a reply's body contains a "Sent via Superhuman" signature, store `replyClient: "Superhuman"`; the detail panel's Replied line reads "Replied via Superhuman". The client patterns live in one list in the tracking core so more can be added.
  - **Backfill.** When an email record has no recipients or a blank subject (e.g. a draft send the adapter misread), fill them from the matched sent message's `To` and `Subject` headers. Matching such a record falls back to time proximity only (the send nearest `sentAt`, within a few minutes) plus our pixel token in the sent body when available.
  - **Mail-app tag on opens: deferred.** Collect real events first; add patterns only once they're visible in the data.

### Dashboard (extension page)
- Views: **Emails** (default), **Stats**, **Health**, **Settings**. A headline strip (Sent · Open rate · Reply rate · Bounce rate) for the selected range sits above them.
- Emails view: a dense table modelled on Mailtrack/Streak tracked-email lists. Columns: recipient, company, subject, sent, status chip, first open, last activity. Filters: status, role, date range, search. Saved quick filter: "Needs follow-up". Clicking a row opens a side panel with the event timeline, editable tags, an "Open in Gmail" link and delete.
- Live updates: a row whose status changes gets a brief highlight; status chips change state with a transition, not a jump.
- Design system: lives in `design/` (DESIGN.md + tokens.css), created via `/design-grill` before any dashboard UI work. Micro-interactions are a primary quality bar (see Further Notes). Components use tokens only.

## Testing Decisions

- **What makes a good test:** it checks external behaviour through the seam (inputs → outputs, or HTTP request → response and stored state), never internal helpers or call order. Fixtures are realistic: actual Gmail HTML structures, real user-agent strings, real ASN numbers.
- **Seam 1: Tracker Worker HTTP API.** Vitest with the Cloudflare Workers pool (Miniflare + local D1). Covered:
  - the pixel bytes and headers for known and unknown tokens,
  - logging only for known tokens,
  - no raw IP stored,
  - auth required on `/api/*`,
  - registration is idempotent,
  - `after` cursor paging.
- **Seam 2: Tracking core.** Vitest, pure functions, no Chrome or DOM APIs. Covered:
  - pixel injection and stripping across plain-only, HTML-only, multipart-style bodies, quoted reply blocks and bodies with existing images,
  - every classification rule row from the PRD table, plus self-view suppression,
  - status precedence and the upgrade rule,
  - thread matching, reply and bounce detection on fixture Gmail API payloads,
  - stats and health numbers against a hand-counted fixture of 10+ emails.
- **Not automated:** the Gmail adapter and the dashboard UI. These are covered by the manual checklist below, run after each change to the adapter.
  - Pixel invisible in Gmail web, Gmail mobile and Outlook.com.
  - Ctrl+Enter is tracked.
  - Toggle off sends untracked.
  - Never-track domain respected.
  - Worker down → email still sends and the toast shows.
  - Viewing my own Sent copy doesn't mark it opened.
  - Opening from a second Gmail account → Opened within 3 min.
  - A reply → Replied.
  - A made-up address → Bounced.
  - A follow-up in a thread keeps the thread and gets a fresh token.
- **Prior art:** none yet (new repo). These tests become the reference patterns.

## Out of Scope

- Click / link tracking and tracked resume/portfolio links (v2: preset links on my own redirect).
- Showing ✓✓ read marks inside Gmail's Sent list, and browser notifications on open (v2 candidates).
- Pre-send lint and the daily send-cap warning (deferred).
- Sending from the dashboard, the local FastAPI app and Gmail send/compose API scopes.
- Phone access or a hosted dashboard; multi-user; Chrome Web Store publishing.
- A custom tracker domain (move later; only new emails would use it).
- Per-recipient tracking in group emails; read time. (Open counts moved into `docs/specs/dashboard-v1-1.md`.)
- Firefox, Safari, Gmail mobile apps and Outlook as sending clients.

## Further Notes

- **Competitor research (2026-10-28):** Mailtrack/Mailsuite centres on ✓✓ read receipts, "first open logged, with time & date", and a simple history of tracked emails. Streak adds a one-click tracking toggle in compose and "all your tracked emails in an organized list … who to follow up with next". Our dashboard borrows the read-receipt status language, the compose toggle and the chronological follow-up list, and drops their visible signatures, campaigns, mail merge and document tools.
- **Design direction for `/design-grill`:**
  - Modern, clean, simple. Dense but calm data tables, few colours, status carried by chips and icons.
  - Micro-interactions are a priority, owned by my-motion and Emil's skills:
    - compose toggle press and state change,
    - toast in and out,
    - row highlight on a live status change,
    - chip state transitions,
    - side panel open and close,
    - inline tag edit save feedback,
    - skeleton loading,
    - filter and tab switches,
    - hover reveals on rows.
- **Accuracy caveat shown in the UI:** opens are reliable for Gmail recipients and unreliable for Apple Mail and Outlook. The Stats provider breakdown makes this visible.
- **EU privacy:** tracking pixels are restricted under EU rules; the never-track list covers EU domains.
- **Week-1 calibration:** check the classification ASN and UA lists against real events, and check the Gmail proxy self-view caching risk.

## Progress

- [x] 1. Tracker Worker: D1 schema, pixel endpoint, `/api/tokens`, `/api/events`, `/api/health`, bearer auth, Worker tests (deploy to workers.dev pending: needs `wrangler login`)
- [x] 2. Tracking core: pixel helpers (newToken, pixelUrl, trackerTokenFromSrc), classifyOpen, deriveStatus, prefillTags, isNeverTrack, isSeedSend with unit tests
- [x] 3. Extension skeleton: MV3 manifest with stable key, background worker, storage module (IndexedDB + settings), settings page with Test tracker
- [x] 4. Gmail adapter + send flow: compose toggle, never-track list, Send/Ctrl+Enter interception, token registration with timeout, fail-open toast, local email record (not done: plain-text-mode warning, since Gmail has no reliable signal for it; collapsed quoted text that Gmail adds at send time can't be stripped)
- [x] 5. Opens sync + self-view suppression (opens stored raw, classified on read via `buildRows`; bare dashboard table for end-to-end checks): background polling of `/api/events`, classification, content-script self-view logging
- [x] 6. Design system: run `/design-grill` → `design/DESIGN.md` + `design/tokens.css` (+ `design/system.html` showcase)
- [x] 7. Dashboard Emails view: table, chips, filters, search, sort, detail panel with timeline and tag editing, live updates, empty state (also: delete with Undo, ahead of slice 11; fonts bundled. Open in Gmail uses a Sent search until slice 8 adds threadId, and assumes account `/u/0/`. Company sits under the recipient, as in design/system.html, not in its own column. Untracked emails count as "Needs follow-up" after N days without a reply.)
- [x] 8. Gmail API sync: OAuth via chrome.identity, thread matching, reply detection, bounce detection, reconnect prompt; plus reply-client tag (Superhuman) and To/subject backfill from the matched sent message (mail-app open tags deferred until real data). (Core in `core/gmail-sync.ts` with fixture tests; background in `gmail.ts`, 5-min alarm + Check now. Not yet run live: needs the Google OAuth client ID in the manifest, see setup-guide Part 4. Records are matched for 2 days after sending and checked for replies for 30.)
- [ ] 9. Stats view + headline strip: rates by variant/role/provider/week, MX provider lookup, small-sample flags
- [ ] 10. Health view + seed tests: bounce/open-drop warnings, stale list, seed marking and placement recording
- [ ] 11. Export/import (JSON + CSV), delete email, README setup guide
- [ ] 12. Polish: review against my-motion and emil-design-eng, then `/impeccable polish`; run the manual Gmail checklist
