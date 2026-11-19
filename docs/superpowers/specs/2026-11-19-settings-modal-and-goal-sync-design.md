# Settings modal rework + goal-WPM sync fix

Date: 2026-11-19 · Status: approved by Michael in conversation · Size: small change

## Intent

Two complaints about the keeb (touchtype) settings modal:

1. "It's a little messy — the content doesn't fit the modal." Michael's diagnosis of the
   mess: the dialog is too small for what it holds.
2. "Goal WPM doesn't sync when I change it."

## Goals

- Every control in the settings modal is reachable on a laptop-height window.
- The modal reads as groups, not as one flat label grid.
- Changing goal WPM (and the two curriculum switches) reaches the atproto settings
  record the same way a finished session reaches the repo: promptly, without a full sync.
- A device that changed its goal must not have a later sync overwrite it with the stale
  remote record and push that stale value back.

## Non-goals

- No new lexicons or record shapes; `app.thatsit.typing.settings` keeps its fields.
- `daily goal (min)` stays device-local (by design — see app/daily.ts).
- No change to the boot-time settings race in `firstUpdated` (`#load` vs `account.boot`);
  out of scope for this change.

## Constraints

- Built on kit: imports stay `https://kit.thatsit.app/lit.js` + `sharedStyles` (Michael
  confirmed the app must stay on kit).
- Existing e2e selectors must keep working: `dialog select` order (0 = keyboard,
  1 = keymap), `.board`, `.problems li`, `input[type=file]`, `[aria-label='Close settings']`,
  `.sync ~ .warn`, button texts "Sign in" / "Publish this layout" / "Sync now", labels
  containing "daily goal", "use real words", "teach in keyboard order".

## Approaches considered

- Modal: (a) just let the dialog scroll; (b) collapse rarely-used groups behind
  disclosures; (c) scroll + section headings, everything visible. Chosen: (c) — Michael's
  complaint is fit, not findability; collapsing adds a click to reach settings that today
  have zero.
- Sync: (a) run a full `syncNow(false)` on every settings edit — drags stats pull/flush
  along with it; (b) push the settings record directly on edit, plus a newer-wins timestamp
  check in `syncNow` so a stale pull can't clobber a fresh local edit. Chosen: (b) — one
  small PUT, matches "sync happens around a session, never inside a keystroke" (sync.ts
  header) because blur on one number field is not a keystroke hot path.

## Design

### Bug mechanism (verified in code)

1. `app-main.ts` `#goal`/`#curriculum` only call `saveSettings` (IndexedDB). Nothing pushes
   the settings record; it only crosses via `Account.syncNow` → `Sync.pushSettings`.
2. In `syncNow`, the adapt branch (`account.ts:118`) adopts the remote `targetCpm` via
   `writeGoal` — which never persists — then `h.reload()` runs async while
   `pushSettings(h.read())` at line 137 fires immediately, so the just-adopted (stale)
   value is pushed back to the repo. The local change never leaves the browser.

### Fix

- `SyncState` gains `settingsLocalAt?: number` (epoch seconds): the moment this device's
  settings last stood (pushed or adopted).
- `Sync.pushSettings` stamps `settingsLocalAt` (before the PUT, so a failed push still
  counts as a local change worth re-pushing) and keeps its record write.
- `Sync.pull` also returns `settingsAt` (the winning record's `updatedAt`) and the stored
  `settingsLocalAt`.
- `Account.syncNow`: adopt settings only when `adapt && settingsAt > settingsLocalAt`;
  after adopting, stamp `settingsLocalAt = settingsAt` and skip the trailing settings push
  (no echo, and no race with the async reload). When local is newer or equal, push as today.
- `Account.settingsChanged()` (new): when connected, read the live values and
  `pushSettings`. Called by `#goal` and `#curriculum` right after `saveSettings`.
- Host `writeGoal`/`writeCurriculum` persist the adopted values into the per-layout
  settings row, so a layout reload can't resurrect the old number — and they do it after
  the record's layout selection is applied, so the values land in the row of the layout the
  record names, not the one being left. While `syncNow` is adopting, `settingsChanged()`
  is suppressed: an adopted value is not a local edit, and echoing it mid-adopt would push
  a half-applied mix with a fresh timestamp.
- Known limitation (reviewer note): the direction check compares two devices' wall clocks
  (`settingsLocalAt` here vs the record's `updatedAt` set by whoever pushed last). Clock
  skew of minutes can pick the wrong side; accepted, because any later edit re-decides and
  the sessions/progress sync is unaffected.
- Known limitation (second-review notes): the sync-state row is lock-free read-modify-write,
  so a `pushLayout` overlapping a pull can still lose one side's bookkeeping (worst case: a
  duplicate progress record, which the newest-wins pick already tolerates). And adopting a
  record that predates the curriculum switches (so names another layout but carries no
  booleans) leaves those switches at the values the targeted layout's own row stores — the
  adopt awaits the row's load before writing, so no value from the layout being left leaks
  in; every record pushed since the switches shipped carries them, so this is legacy-only.

### Modal

- `dialog`: keep centred card; add `max-height: min(85dvh, 44rem); overflow-y: auto;` and
  widen to `min(26rem, calc(100vw - 2rem))`; `modal-head` becomes `position: sticky` so
  Close stays reachable.
- `.panel` keeps the two-column grid but gains four uppercase group headings (`.group`,
  same micro-label type the insights cards use): **Keyboard** (board, keymap, goal wpm),
  **Practice** (daily min, the two curriculum switches), **Account** (the existing `.sync`
  line + `warn` note, `.sync` now wraps and the DID word-breaks), **Layout files** (import
  picker, imported boards/maps rows, problems list).
- Empty groups render nothing (boards/problems only when non-empty, as today).

## Left to the builder

Exact px of group spacing; class names; whether `.sync` wraps before or after the buttons.
