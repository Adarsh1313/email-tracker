# Spec: Tracker v2 (engagement signals, hygiene, open-source release)

Status: ready-for-agent
Sources: `docs/decisions.md` (incl. "Link and resume tracking (2026-11-05)"), `docs/research/competitors.md`, the grilling session of 2026-11-08. Builds on `docs/specs/email-tracker.md`, `docs/specs/dashboard-v1-1.md` and `design/DESIGN.md`.

## Problem Statement

I use this tracker to see whether my cold emails during a job search are working. It works, but it has gaps:

- A reply with no recorded open shows as "Not opened", which is misleading.
- I find out about an open only by opening the dashboard.
- Gmail's Sent list says nothing about engagement.
- The Worker stores every fetch, with no protection from noisy repeats, and keeps data forever.
- Plain-text compose silently can't be tracked.
- When an email goes to several people (a thread, an introduction through Boardy) I can't tell who engaged.
- Other people looking for jobs could use this, but there is no one-command setup, no README, and my own IDs are mixed into the repo.

## Solution

Add engagement signals (reply-over-open status, "Replied (name)", notifications, Gmail Sent-list chips, a plain-text warning), harden the Worker (short-window dedupe, per-IP cap, auto-deletion of old events), add a Settings setup checklist and privacy controls, spike per-recipient pixels, and package the project so anyone can fork it, run one setup command, and keep all their data on their own machine. Then publish it as an MIT-licensed public repo.

## User Stories

1. As a job seeker, I want an email that got a reply but no recorded open to show "Replied (open tracking missed)", so that I'm not misled into thinking it was ignored.
2. As a job seeker, I want a reply to outrank an open in the row status, filters and follow-up logic, so that I follow up only on emails that really need it.
3. As a job seeker, I want "Replied (Priya)" when one of several recipients replies, so that I know which person engaged.
4. As a job seeker, I want a desktop notification when a human first opens a tracked email, so that I can follow up while it's fresh.
5. As a job seeker, I want that notification delayed about 10 seconds, so that my own view of the Sent copy cancels it.
6. As a job seeker, I want a second notification only when an email is re-opened after more than an hour, so that I'm told about renewed interest without being spammed.
7. As a job seeker, I want notifications off by default with a toggle in Settings, so that I opt in.
8. As a job seeker, I want a small chip ("Opened 3×", "Replied") next to tracked emails in Gmail's Sent list, so that I see engagement without leaving Gmail.
9. As a job seeker, I want the Gmail chips to fail quietly if Gmail's markup changes, so that Gmail never breaks.
10. As a job seeker, I want a banner "Not tracked: plain-text mode" in compose, so that I know before sending.
11. As the Worker owner, I want fetches of the same token from the same source within about 5 seconds deduplicated, so that image-loading bursts count once.
12. As the Worker owner, I want a per-source hourly cap on stored events (the pixel is still served), so that abuse can't fill my free plan.
13. As the Worker owner, I want events older than a retention period (default 90 days) deleted automatically, so that old data doesn't pile up.
14. As a job seeker, I want to change the retention period in Settings, so that I control how long the Worker keeps data.
15. As a first-time user, I want a live setup checklist at the top of Settings (Worker reachable, API secret matches, Gmail tab loaded, Gmail sync connected (optional), first test open seen), so that I see what's left without a guide.
16. As a first-time user, I want each failed check to have a one-line fix, so that I can recover alone.
17. As a first-time user, I want a "Send a test email to yourself" action that turns the last check green when the test open arrives, so that I know tracking works end to end.
18. As a privacy-minded user, I want "Delete all my local data", so that I can wipe the extension's data.
19. As a privacy-minded user, I want "Delete all Worker events", so that I can wipe what the Worker stores.
20. As a privacy-minded user, I want Export and Import to keep working, so that I can move my data between browser profiles.
21. As a job seeker, I want to see which recipient opened an email sent separately to each, so that I can follow up with the right person.
22. As a job seeker, I want "Send separately to each" as an opt-in per email (default off), so that single-recipient cold email is unchanged.
23. As a job seeker, I want a failed separate-send to fall back to a normal single send with a warning, so that I never lose an email (fail open).
24. As a job seeker, I want my attachments (the resume) sent to every separate copy, so that nothing is missing.
25. As a forker, I want `npm run setup` to install dependencies, log in to Cloudflare, create the database, generate secrets, deploy the Worker, generate my own extension key and build the extension, so that I'm running in minutes.
26. As a forker, I want setup to pre-fill the Worker address and secret into the extension, so that I never paste them.
27. As a forker, I want Gmail reply sync to be optional and off by default, with an in-Settings walkthrough that shows my own extension ID, so that I can enable it later.
28. As a forker, I want a clear note that a free Cloudflare account is needed, so that I'm not surprised.
29. As a forker, I want `npm run demo-data` to load about 20 fake emails (opens, replies, a bounce), so that I can see the dashboard before my first send.
30. As a reader of the README, I want the job-search story, screenshots from fake data, a feature list, an honest comparison with other trackers and a privacy section, so that I can judge whether it fits me.
31. As a reader of the README, I want a roadmap listing what is not built (signed pixel IDs, link tracking, forward detection), so that I know the limits.
32. As a contributor, I want an MIT license, a short CONTRIBUTING note and "shared as is, PRs welcome, no support promises", so that expectations are clear.
33. As the project owner, I want no personal IDs, secrets or private email in the public repo, so that open-sourcing doesn't expose me.
34. As the project owner, I want my own build to keep working through my git-ignored local config, so that I'm not locked out of my own setup.

## Implementation Decisions

**Status and reply logic (extension core)**
- Status precedence stays: Bounced > Replied > Opened > Opened (uncertain) > Not opened. The status builder gains a sub-state: "Replied, no open recorded", shown as "Replied (open tracking missed)".
- When a reply is detected from a specific recipient on a multi-recipient email, the row shows "Replied (<name or address>)". Reply sync already knows the sender.
- Follow-up nudges and filters treat Replied as terminal; they must not nudge an email that has a reply.

**Worker hygiene**
- Dedupe: fetches of the same token from the same hashed source within about 5 seconds are stored once.
- Per-source cap: a bounded number of stored events per token per source per hour. Over the cap, the pixel is still returned and nothing is stored.
- Retention: a scheduled trigger deletes events older than a retention period (default 90 days). The period is a Worker setting the extension can change through the authenticated API.
- New authenticated API operations: delete all events, and read/update retention. Deletion removes opens and tokens but never touches the extension's local data.
- The schema gains whatever is needed for dedupe and settings; no recipient data is ever added (existing rule).

**Notifications**
- Raised by the background poller after classification, only for the first human open and for re-opens after a gap of more than one hour.
- A 10-second hold lets a self-view cancel the notification.
- Off by default; a toggle in Settings. The permission is requested when the user turns it on.

**Gmail Sent-list chips**
- Implemented in the single Gmail DOM module (`gmail-dom`), reading engagement from local data. Any failure to locate rows results in no chips and no error.

**Plain-text warning**
- Detected in compose by the Gmail DOM module and shown as a "Not tracked" banner. Sending still proceeds (fail open).

**Settings**
- A setup checklist at the top, updated live: Worker reachable, API secret valid, a Gmail tab has the extension, Gmail sync connected (optional, marked as such), first test open received.
- A "Send a test email to yourself" action.
- New options: notifications on/off, retention days, and (after the spike) the "Send separately to each" default.
- Privacy controls: Delete all local data, Delete all Worker events. Both ask for confirmation.
- The Settings UI is redesigned per `design/DESIGN.md` and `design/tokens.css` (tokens only). Polish goes through the motion and impeccable skills after the build.

**Per-recipient pixels (spike, then build if viable)**
- First a throwaway prototype of "Send separately to each" for 2–5 recipients with attachments, driven through the Gmail compose window, always falling back to a normal single send with a warning.
- If it works cleanly, build it as an opt-in toggle next to Send, default off. Each copy gets its own token and its own email record, linked as a group so the dashboard can show one row with per-recipient opens.
- If it fails, keep "one of N recipients" and document the limit. Forwards stay uncountable either way.

**Open-source packaging**
- License MIT. Repo name `email-tracker`, public under the owner's GitHub account, created only after all slices above are done and the owner confirms.
- `npm run setup` at the repo root: install, Cloudflare login, create the D1 database, write `wrangler.local.jsonc`, generate and set `API_SECRET` and `IP_SALT`, deploy, generate the forker's extension key, write the pre-filled config into the build, build the extension, and print how to load it.
- The extension reads the pre-filled Worker address and secret on first load, once, so Settings starts filled and "Test tracker" passes.
- The manual guide is kept as a fallback and updated to match.
- Gmail sync is optional and off by default. Settings shows the exact extension ID derived from the forker's own key for their Google Cloud OAuth client.
- Personal values stay in git-ignored local files (already done): OAuth client ID and extension key in the extension's local config, D1 ID in the Worker's local config.
- `npm run demo-data` seeds fake emails into the dashboard; all README screenshots come from it.
- README contains: the job-search story (cold-email strategies from several sources), the problem, feature list, screenshots, setup, privacy model (recipients and subjects stay in the browser; tokens and events stay in the owner's Worker; no telemetry), comparison with other trackers, limits (Apple MPP, Gmail proxy caching, forwards, desktop Chrome only) and roadmap.
- Distribution is clone, setup, load unpacked. No Chrome Web Store, no hosted service.

**Architectural notes**
- The Worker must still never store names, email addresses, subjects or raw IPs. Fail-open behaviour is unchanged. All Gmail selectors stay in one module.

## Testing Decisions

- A good test checks external behaviour through a public seam: an HTTP request to the Worker, or the inputs and outputs of a pure core function. It does not test private helpers or DOM internals.
- **Seam 1: Worker HTTP API** (prior art: the existing Worker tests: pixel, auth, token registration, open events). Covers dedupe, the per-source cap, retention deletion, delete-all, and the retention setting.
- **Seam 2: pure core functions in the extension** (prior art: the existing classify, status, rows, gmail-sync and emails-view tests). Covers reply-over-open status, "Replied (name)", notification eligibility (first open, 1-hour re-open rule, 10-second self-view cancel) and the grouping of separate-send copies.
- **Not unit-tested, checked by hand on a real send:** Gmail DOM behaviour (chips, plain-text banner, separate send) and Gmail's repeat-open caching. The repeat-open test: send to a second Gmail account, open it 3 times a few minutes apart, and compare the count.
- Setup and README are verified by running `npm run setup` from a clean clone.

## Out of Scope

- Signed or rotating pixel IDs. The random tokens are single-use and unguessable, and the Worker only logs registered tokens.
- Link tracking and redirects. A portfolio visit beacon is a separate later spec.
- Forward detection (decided out on 2026-10-28) and quoted-pixel stripping (already built).
- A Chrome Web Store listing, a hosted version, accounts or telemetry.
- Mobile or non-Gmail sending.
- Identifying who a recipient is beyond which recipient token or reply sender.

## Further Notes

- Gmail's image proxy may cache the pixel, so the repeat-open count is a minimum. The first open is the reliable signal.
- Opens in the first 10 minutes after send show as uncertain (own-phone views). This stays.
- Seensy and the open-source projects in `docs/research/competitors.md` are the inspiration; our differences are local-first recipient data, four-way open classification, and reply and bounce handling.
- The Gmail DOM work (chips, plain-text banner, separate send) is the riskiest part; do it last and keep it behind the fail-quiet rule.

## Progress

- [x] 1. Worker hygiene: dedupe, per-source cap, retention cron, delete-all, retention setting (Worker tests)
- [x] 2. Status: "Replied (open tracking missed)", reply ranking, "Replied (name)" (core tests)
- [x] 3. Plain-text warning in compose
- [x] 4. Desktop notifications with the 10-second hold and the 1-hour re-open rule, plus Settings toggle
- [x] 5. Settings: setup checklist, test email, retention and notification options, privacy delete buttons, UI redesign
- [x] 6. Gmail Sent-list chips
- [ ] 7. Per-recipient pixels: spike, decide, then build or document the limit (prototype built: "Separate" button in compose opens one prefilled draft per recipient, groupId + groupRows core done; awaiting hand test, then wire grouped rows into the dashboard or document the limit)
- [x] 8. Open-source packaging: `npm run setup`, pre-filled config, optional Gmail sync walkthrough, `npm run demo-data`, manual guide update
- [x] 9. README (story, screenshots from demo data, comparison, privacy, roadmap), LICENSE (MIT), CONTRIBUTING
- [x] 10. Final check from a clean clone, then create the public GitHub repo (published at https://github.com/Adarsh1313/email-tracker from a fresh single-commit history; `npm run setup` on Cloudflare not yet run)
