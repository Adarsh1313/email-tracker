# Competitor research (2026-11-08)

Thin coverage: 4 open-source projects confirmed. Mailtrack details are vendor claims. Not researched: Streak, Yesware, Superhuman, Mixmax, Mautic, Listmonk, Postal.

| Project | Stack | Notable |
|---|---|---|
| samrathreddy/mail-tracker (AGPL) | MV3 + Worker + KV | Ticks in Gmail, Chrome/webhook notifications held ~10 s so self-views are caught, 5 s dedupe, per-recipient pixels. Stores IPs. Binary bot filter. |
| steipete/gogcli (`gog gmail send --track`) | CLI + Worker + D1 | Encrypted, key-rotating pixel IDs, per-IP hourly cap, 90-day retention cron. Stores recipient email and IP. |
| ayushkcs/Trackio | Next.js + Postgres + MV3 | `declarativeNetRequest` blocks the pixel while composing and viewing Sent; self-view ping. Heavy setup. |
| shlokjain2031/email-tracker-extension | MV3 + Node + SQLite | Needs a server. Docs unreadable. |
| Mailtrack (closed) | | "Replied but never opened" warning, pixel-free Sent copy, plain-text warning, forward-burst hint. |

## What we do differently
Recipient data stays in the browser; the Worker holds tokens and events only. Four-way open classification. Gmail-API reply/bounce detection and follow-up nudges. Fail-open. No link rewriting. Worker + D1 hosting.

## Features we lack
Gmail ticks/open chips, notifications, "replied but zero opens" warning, plain-text warning, short-window dedupe + per-IP cap, signed pixel IDs, retention cron, per-recipient pixels, quoted-pixel stripping.

## Gmail proxy caching
Unverified whether `no-store` helps. Test on a real send (second Gmail, 5 re-opens). Treat first open as the hard signal and repeat count as a minimum.
