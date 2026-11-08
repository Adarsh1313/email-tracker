# Email Tracker

Personal cold-email open tracker. A Chrome extension adds a hidden pixel when you send from Gmail; the dashboard is an extension page. Decisions: `docs/decisions.md`.

## Stack
- `extension/`: Chrome MV3, TypeScript, loaded unpacked. Recipient data stays in the browser (`chrome.storage` / IndexedDB).
- `worker/`: Cloudflare Worker (TypeScript) + D1 on `*.workers.dev`. Stores only tokens and open events.
- Gmail API (read-only) via `chrome.identity` for replies and bounces.

Commands (run inside `worker/` or `extension/`):
- `npm test`, `npm run typecheck`
- worker: `npm run dev`, `npm run deploy`
- extension: `npm run dev` (rebuilds on save and the loaded extension reloads itself, plus open Gmail tabs), or `npm run build` for a one-off build. Load `extension/dist/` unpacked in chrome://extensions once

## Folder map
- `docs/decisions.md`: grilling decisions that override the PRD
- `docs/specs/`: feature specs with Progress checklists
- `design/`: DESIGN.md, tokens.css, moodboard/

## Project rules
- The Worker must never store names, email addresses, subjects or raw IPs.
- Fail open: if pixel injection or token registration fails, the email still sends; show a "not tracked" warning.
- Keep every Gmail DOM selector in one module (Gmail changes its page markup without notice).
- No click tracking or link rewriting in v1.
- Never commit `.dev.vars`, OAuth client secrets or `*.db`.

## Agent skills

### Issue tracker

Local markdown: specs in `docs/specs/`, tickets under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the root. See `docs/agents/domain.md`.
