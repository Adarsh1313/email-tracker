# Email Tracker — design system

## What this is
The UI of a personal Chrome extension that tracks opens and replies to cold emails sent from Gmail.
Surfaces: the dashboard page (Emails, Stats, Health, Settings), plus two small pieces inside Gmail:
the compose tracking toggle and the "sent without tracking" toast.
One user, used daily. Mostly **read** (scan who opened, who to nudge), occasionally **operate**
(fix a tag, delete a test). Values live in `design/tokens.css`; the extension imports that file as is.

## Direction
**Quiet ledger.** A calm, paper-like ledger of sent mail where status ink is the only colour on the page.
Rows are lines in a book, separated by hairline rules. Nothing moves until something actually happens.

## Signature element: the ink stamp
Every email's status is a small stamped mark in its status ink, using read-receipt language:

| Status | Mark | Ink | Frame |
|---|---|---|---|
| Not opened (sent) | ✓ | `--ink-pending` | solid hairline |
| Opened | ✓✓ | `--ink-opened` | solid |
| Opened (uncertain) | ✓✓ | `--ink-uncertain` | dashed (doubt) |
| Replied | ↩ | `--ink-replied` | filled wash |
| Bounced | × | `--ink-bounced` | filled wash |
| Untracked | — | `--ink-faint` | dashed, faint |

When a status changes live, the new mark **stamps in**: it lands from slightly larger and transparent,
and a single ink-bleed ring spreads and fades behind it. That is the only expressive motion in the product.
The stamp always has a text label next to it or an accessible name; colour is never the only signal.

## Colour
- **Paper and ink.** Warm off-white paper, near-black warm ink. Dark mode is warm charcoal paper with cream ink.
  Neutrals are warm (yellow-brown cast), never blue-grey.
- **No brand accent.** Status inks are the only colour: green opened, indigo replied, ochre uncertain,
  brick bounced, graphite pending. Each has a `-wash` tint for filled stamps and soft backgrounds.
- **Active / selected = inverted ink chip.** Current tab, active filter and segmented choice are solid ink
  with paper-coloured text. One shared chip slides between items. A selected **row** uses `--selection-tint`
  instead (full inversion is too heavy on rows).
- Status inks never appear on buttons, links or chrome. Links are ink with an underline.
- Errors use `--ink-bounced`; warnings use `--ink-uncertain`. No other alert colours.

## Type
- `--font-serif` Newsreader for page titles, the headline numbers and empty-state headings only.
- `--font-sans` Inter Tight for everything else. Tabular figures (`--numeric`) for times, counts and rates.
- Scale: caption 12 · label 13 · body 14 · title 22 (serif) · display 34 (serif numbers).
- Weights: 400 body, 500 labels and emphasis, 600 only for the inverted chip and column headers.
- Sentence case everywhere, including buttons and headers. No all-caps except the tiny column-header style
  (`--text-overline`, tracked).
- Fonts are OFL-licensed and must be bundled in the extension (no remote font loading in production).

## Shape and space
- 4px base spacing scale (`--space-*`). Rows are 40px (`--row-height`), compact but breathable.
- Hairline rules (`--hairline` in `--rule`) separate rows and sections. No zebra striping.
- Radius: `--radius-control` 6px (buttons, inputs, chips, stamps), `--radius-panel` 10px (cards, side panel, toast).
- Depth: flat by default. Only the side panel and toast cast `--shadow-float`. No glows, no glass.

## Components (v1)
Each has default, hover, pressed, focus, disabled and (where relevant) loading, empty and error states.
- **Buttons:** primary (ink fill), secondary (hairline outline), ghost (text only), icon button.
- **Tabs / segmented / filter chips:** inverted ink chip that slides.
- **Search input, select, text input** (inline tag editor).
- **Switch** (settings) and the **compose tracking toggle** (inside Gmail: an eye mark, on = ink, off = faint with a slash).
- **Headline strip:** four serif numbers (Sent · Open rate · Reply rate · Bounce rate) with small labels.
- **Emails table + row**, stamp, relative time with the exact time on hover, row hover actions.
- **Side panel:** timeline of events (sent, opens with classification, reply, bounce) + tag editor.
- **Toast, skeleton rows, empty state, error banner, health card** (ok / warning).

## Voice
- Short, plain, sentence case. Facts first: "Opened 2h ago", "No reply yet", "Bounced: address not found".
- Name the thing, not the feeling. No exclamation marks, no "Oops", no "Awesome".
- Banned: crush, boost, supercharge, magic, seamless, unlock, hack, 🚀.
- Uncertainty is stated, not hidden: "Opened (uncertain): Apple Mail may preload images".

## Motion
Personality: calm and precise. my-motion defaults apply; this table is the full list of moments.

| Moment | What moves | Token |
|---|---|---|
| Button / chip / row hover | background and colour fade | `--duration-hover`, `--ease-colour` |
| Press | scale to `--press-scale` | `--duration-hover`, `--ease-out` |
| Tab / filter / segmented change | one inverted chip slides; labels crossfade | `--duration-move`, `--ease-out` |
| Tab content swap | content fades .4 → 1 | `--duration-swap` |
| Switch / compose toggle | knob glides, track fades; knob stretches on hold | `--duration-move` |
| Side panel open | fades in and rises from the right edge; contents follow 80ms later | `--duration-enter` |
| Side panel close | contents fade, panel leaves | `--duration-exit` |
| Toast | fades in, rises `--rise-distance`; leaves faster | `--duration-enter` / `--duration-exit` |
| **Stamp lands (signature)** | mark lands from `--stamp-from-scale`, ink ring spreads and fades | `--duration-stamp`, `--duration-bleed` |
| Live row update | row washes `--selection-tint`, then fades back | `--duration-confirm` |
| Inline tag saved | field swaps to a ✓ "Saved" confirm, reverts | `--duration-move`, `--duration-confirm` |
| Skeleton loading | slow shimmer (the only loop, only while loading) | `--duration-shimmer` |

Nothing animates on page load except skeletons. Typing, sorting and keyboard navigation have no motion.
Reduced motion: every duration becomes 0, things jump to their end state, and the shimmer stops.

## Anti-references
- Mailtrack / Mailsuite's mint-on-dark-green SaaS marketing look.
- Generic Tailwind admin dashboards: slate greys, blue primary buttons, KPI cards with coloured icons.
- Purple or blue gradients, glassmorphism, neon glows, confetti.
- LocalFlow's Graphite Capsule (graphite surfaces, white-means-active, capsule shapes).
- Gmail's Material look; this lives beside Gmail and shouldn't pretend to be part of it.

## Anti-slop watchlist
- A status chip with an icon in a pastel pill: use the stamp.
- Cards around everything: rows and hairlines are the structure.
- Coloured headline numbers or trend arrows in green and red: numbers stay ink.
- Emoji in UI copy, "✨" anything, gradient text.
- Drop shadows on rows or buttons; more than two radii.
- Animating every number or row on load.

## Open questions
- Fonts are loaded from Google Fonts in `system.html` only; bundle Newsreader and Inter Tight woff2 into
  the extension when building slice 7.
- Stats charts (slice 9): bars in ink with status inks only for open/reply series; check with the dataviz skill then.
- Should the compose toggle show the eye icon, or a tiny stamp to echo the signature? Decide in the polish pass.
