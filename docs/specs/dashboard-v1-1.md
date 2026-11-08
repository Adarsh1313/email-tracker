# Spec: Dashboard v1.1

Status: ready-for-agent
Sources: `docs/decisions.md` → "After the first live Gmail test (2026-10-28)", "Spec next". Builds on `docs/specs/email-tracker.md` (slice 7, Emails view) and `design/DESIGN.md`.

## Problem Statement

The first live test showed the Emails view answers "was it opened?" but not "by whom, and how often?". With several recipients I can't tell that only one of them opened. The table always shows every column, even ones I rarely read. When the list grows, the filters and the table header scroll away. And when I read my own Sent copy in the Gmail phone app, the extension logs no self-view, so my own read shows as a real open with no way to correct it.

## Solution

Small additions to the existing Emails view and Settings page:
- the Opened status gets a sub-line saying who opened and how many times,
- a "Columns" menu hides or shows the optional columns, remembered across visits,
- the filters sit in a raised band and the table header sticks while scrolling,
- each open in the detail timeline gets a "That was me" hover action that reclassifies it as my own view, with Undo,
- Settings explains the phone-app blind spot.

## User Stories

1. As a sender, I want "by priya@acme.io" under an Opened status, so that I know who read it.
2. As a sender, I want "by one of 3 recipients" when the email went to several people, so that I'm not misled into thinking everyone read it (the pixel is shared, so we can't tell which one).
3. As a sender, I want an open count ("Opened 3 times"), so that I can see repeated interest.
4. As a sender, I want the count to include only opens that count towards the status (human and uncertain), so that scanners and my own views don't inflate it.
5. As a sender, I want a "Columns" button to toggle Company, Subject, First open and Last activity, so that the table shows only what I read.
6. As a sender, I want my column choices remembered, so that I set them once.
7. As a sender, I want Recipient and Status always shown, so that a row is never meaningless.
8. As a sender, I want the filters in a raised band with a hairline under it, so that controls read as separate from data.
9. As a sender, I want the table header to stay visible while I scroll, so that I know which column is which in a long list.
10. As a sender, I want a "That was me" action when I hover an open in the timeline, so that I can correct my own phone-app reads.
11. As a sender, I want "That was me" to take effect at once (status, count and first open recompute), so that the list is right immediately.
12. As a sender, I want an Undo toast after "That was me", so that a misclick costs nothing.
13. As a sender, I want an override to survive reloads and syncs, so that I fix each open once.
14. As a sender, I want a Settings tip that explains why phone-app reads of my Sent copy count as opens and how to fix them, so that the behaviour isn't a mystery.

## Implementation Decisions

### Tracking core (pure, tested)
- `EmailRow` gains `openCount: number` (opens classified human or uncertain, after overrides).
- `openedBy(row)` → `string | null`: null unless status is opened or opened_uncertain; `"by <address>"` for one recipient; `"by one of N recipients"` for several; null when `to` is empty.
- `openCountLabel(n)` → `"2 times"`, `"3 times"`…, null below 2, so a single open reads just "Opened" and repeats read "Opened · by priya@acme.io · 3 times".
- `timelineOf` items carry `openId` and `overridden` so the panel can offer "That was me"; overridden opens read "Marked as you".
- **Overrides.** `buildRows(emails, opens, selfViews, rules, overrides)` takes a set of open ids I marked as mine; those opens are classified `self` regardless of the rules. Overrides never touch the Worker or the raw events: classification stays a read-time step (as in slice 5).
- Column visibility is not core logic: the table's order is fixed (Status, To + company sub-line, Subject, Sent, First open, Last activity), and toggles are classes on the table. Status, To and Sent are always shown. Default: all on.

### Storage
- Overrides: a new IndexedDB store `overrides` keyed by open id (`{ openId, classification: "self", at }`). Bump the DB version; the upgrade only adds the store. Included in the JSON export in slice 11.
- Column prefs: `chrome.storage.local` key `columns` (`{ company, subject, firstOpen, lastActivity }` booleans), outside `Settings` so the Settings form doesn't save them.

### Dashboard
- Status cell: the stamp + label as today; under it a small faint sub-line: `openedBy` and, when ≥ 2, the count ("by priya@acme.io · 3 times"). Uses existing small/faint text tokens.
- Company: today it's a sub-line under the recipient (slice 7). The Company toggle shows or hides that sub-line; it does not add a new column.
- "Columns" button sits at the right end of the filter band. It opens a small menu of checkboxes (keyboard reachable, Esc closes). Toggling hides the `<th>`/`<td>` for that column via a class on the table, no re-render.
- Filter band: raised surface token + a hairline bottom border; it and the table header are `position: sticky` (header sticks below the band).
- Timeline: each open item (any classification other than self from an override) shows "That was me" on row hover and focus. Clicking stores the override, re-runs `buildRows`, and shows the Undo toast (reuse the delete-with-Undo toast). Undo deletes the override. An overridden open shows the mirror stamp and the label "Marked as you".
- Settings page: a short tip under the classifier/Gmail section: "Reading your own Sent copy in the Gmail phone app can't be detected, so it shows as an open. Hover the open in the email's timeline and choose That was me."
- Motion: menu open/close, sticky band, toast and stamp changes follow `my-motion` and `design/DESIGN.md` tokens. No new raw hex or px.

## Testing Decisions

- Unit tests (Vitest, tracking core) for: `openedBy` (one / several / none / not opened), `openCountLabel`, `openCount` in `buildRows` (excludes automated and self), overrides in `buildRows` (an overridden human open becomes self; status falls back, e.g. Opened → Not opened when it was the only open; first open moves to the next counted open).
- Not automated: the Columns menu, sticky band, hover action and Undo toast. Manual check after the slice: load unpacked, toggle each column and reload (remembered), scroll a long list (header sticks), mark an open as me and undo.

## Out of Scope

- Per-recipient open attribution (needs one pixel per recipient; out per v1 spec).
- Detecting phone-app self-views automatically.
- AI-reader and forward detection (decisions.md, "Out").
- Column reordering or resizing.

## Progress

- [x] 1. Core: `openCount`, `openedBy`, `openCountLabel`, overrides in `buildRows`, timeline `openId`/"Marked as you", with unit tests (`visibleColumns` dropped: toggles are CSS classes)
- [x] 2. Storage: `overrides` IndexedDB store (DB version 2), column prefs in `chrome.storage.local` (`src/columns.ts`). The dashboard writes overrides to IndexedDB directly, so no messages were needed
- [x] 3. Dashboard: status sub-line (opened by + count), Columns menu with remembered choices, raised filter band + sticky header (checked in a browser preview with seeded data; "remembered" not checkable there, since the preview stubs chrome.storage)
- [x] 4. Dashboard: "That was me" hover action with Undo, "Marked as you" timeline label; Settings phone-app tip (checked in the browser preview: count, first open and status recompute; Undo restores)
