# Keeb layered-layout support — design

**Date:** 2026-11-16 · **Status:** PROPOSED (awaiting Michael's approval)

## Intent / why

Michael's Go60 (Gallium 36-core) uses a ZMK layered layout (file `go60-36.json`, 6 layers).
Keeb currently imports only layer 0 of a keycap file, so layered targets are invisible and
unreachable. This adds: import all layers, show the active layer on the board, and highlight
the layer-switch key in the visualization (no text hint).

## Goals

1. `keymapFromKeycap()` reads **all** `file.layers`, not just `layers[0]`.
2. `Keymap` carries `layers: string[][]` + `layerNames: string[]`.
3. `tt-keyboard` renders the **active layer's** characters (new `layer` prop); falls back to
   the row grid / geometry label when the keymap has no `layers` (built-in boards unchanged).
4. When the target character only exists on a different layer, the board highlights that layer's
   switch key with a distinct accent ring (`hintId`) — the learner presses it, the active layer
   switches, then presses the target.

## Non-goals

- No editing of layers, no multi-key macro/shortcut teaching, no mouse-key targets.
- No new board geometries (positions still come from the known board; keycap files supply chars only).

## Constraints

- ZMK keycap JSON: `layers` is a flat array of bindings in the board's matrix order; `layer_names`
  gives display names. Built-in keymaps (no `layers`) must keep working.
- The `focusId` ring and `hintId` ring must be visually distinct (focus = primary dashed ring,
  hint = accent-color solid ring).

## Approaches considered

1. **Full layer support (chosen):** import all layers, track `activeLayer` in the engine, render
   the active layer, highlight the layer key. Trade-off: touches 6 files, ~2–3 hours.
2. Hint-only: keep layer 0 as the base keymap, detect which layer each char is on, show a text
   hint. Rejected: Michael asked for a highlight, not a printed hint.
3. Full + modifier teaching: lesson treats off-layer targets as two-step (switch key, then char).
   Superseded by approach 1 with the highlight replacing the printed hint.

## Decided (my calls, check while reading)

- **Layer-switch key detection:** a key is a layer switcher when its binding is `&trans`, or a
  custom/hold-tap binding whose hold goes to a layer index. The engine treats a press of that key
  as a consumed input (no char, no error) that flips `activeLayer` to the target layer.
- **Hint styling:** `hintId` gets an accent-colored solid ring; `focusId` keeps the primary
  dashed ring.
- **Layer indicator:** the practice-line readout gains a `layer` cell showing the active layer's
  name (e.g. "layer: num").

## Files touched

- `src/layout/keycap.ts` — import all layers into `keymap.layers`
- `src/keyboard/types.ts` — `Keymap.layers` + `Keymap.layerNames`
- `src/keyboard/resolve.ts` — per-active-layer char resolution
- `src/keyboard/view.ts` — `layer` + `hintId` props, hint ring style
- `src/lesson/engine.ts` — `activeLayer` state, layer-key press handling
- `src/ui/practice-line.ts` — layer cell in the readout
- `src/app-main.ts` — wire active-layer state to the board

## Left to the builder

- Exact detection of layer keys from ZMK binding values (edge cases: `&lt_bspc` hold-to-layer vs tap-to-space).
- Whether `activeLayer` persists across reloads (settings) or resets to 0 (my call: reset, it's session state).
