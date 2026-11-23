# Hide the keyboard visualization

Date: 2026-11-22 · Status: approved by Michael in conversation · Size: small change

## Intent

Michael wants a one-click way to hide the keyboard board on the practice screen. The board is
the one large visual block on the line, and on some windows it is noise.

## Goals

- One click in the header hides / shows the keyboard visualization.
- The choice is remembered on this device across reloads.
- The hidden state is announced in words (`aria-pressed` + `aria-label`), never by colour alone.

## Non-goals

- No change to the lesson, the engine, or the progress list in the aside: focus and unlocks still
  read from the same ladder() call as before.
- Not per-layout, not synced: a display preference, like the daily-goal minutes — not part of the
  per-layout `Settings` row, so it never reaches the atproto record and never resets on a layout
  switch.
- The layer hint line under the board (`routeHint`) is part of the keyboard visualization, so it is
  hidden too; the aside's progress rows are not — they are the lesson's real job, and stay.

## Constraints

- Kit rules: icon button via the existing `.x` recipe (borderless 36px, `aria-label`), comment-
  headed icon inlined from Lucide in `src/ui/icons.ts`, imports stay `https://kit.thatsit.app/lit.js`.
- Existing e2e selectors must keep working (`tt-keyboard` still renders by default).

## Approaches considered

- (a) Settings-dialog switch, device-wide — ruled out by Michael, which is why this is a header button.
- (b) Header icon button, instant toggle — **picked**. One click, state lives in the page, nothing
  else changes on the keyboard side.
- (c) Settings dialog switch, per-layout + atproto — a display preference has no business on the wire.

## The design

- New `src/app/keyboard-visibility.ts` mirroring `src/app/daily.ts`:
  `savedKeyboardVisible()` (default true; any unrecognised value answers true) and
  `setKeyboardVisible(visible: boolean)`, stored in localStorage under `keeb:keyboardVisible`.
- `app-main.ts`: `keyboardVisible` reactive state, initialised from `savedKeyboardVisible()`.
  Header gets a second `slot="actions"` button (keyboard icon) next to the settings gear:
  `aria-pressed=${String(!this.keyboardVisible)}`, label "Hide keyboard" / "Show keyboard".
  Clicking flips the flag and writes it; the render conditionally renders `<tt-keyboard>` and
  `routeHint(...)`.
- `docs/spec.md`: one bullet next to the daily-goal bullet in §13 noting the visibility slot is
  device-wide, localStorage, never on the wire.

## Tests

- Unit (`test/keyboard-visibility.test.ts`): default true, garbage → true, write/read round-trip.
- e2e (`e2e/keyboard-toggle.spec.ts`): board visible on load; click → board and hint gone;
  reload → stays gone; click again → board back.
- The two new state-changing switches must stay under the dialog-switch count test: the toggle is
  NOT a dialog switch, so `settings.spec.ts`'s `toHaveCount(2)` is unaffected.

## Left to the builder

Icon variant (Lucide "keyboard" inlined, matching the other icons); exact ordering of the two
action buttons (keyboard first, settings last).
