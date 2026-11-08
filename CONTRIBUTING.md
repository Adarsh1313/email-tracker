# Contributing

This is a personal tool shared as is. Pull requests are welcome, but there are no support promises and no response-time promises. Forking is the intended way to make it yours.

- Run `npm test` and `npm run typecheck` in `worker/` and `extension/` before opening a PR.
- Keep the project rules: the Worker never stores names, email addresses, subjects or raw IPs; fail open; every Gmail selector lives in `extension/src/content/gmail-dom.ts`; no click tracking in v1.
- Never commit secrets, OAuth client IDs, extension keys, `wrangler.local.jsonc` or `.dev.vars`. Personal values go in the git-ignored local files described in `docs/setup-guide.md`.
- UI changes use the tokens in `design/tokens.css` (see `design/DESIGN.md`); no raw colour or size values.
- Design decisions are recorded in `docs/decisions.md`; specs are in `docs/specs/`.
