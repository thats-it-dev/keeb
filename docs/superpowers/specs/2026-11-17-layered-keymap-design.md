# Design: layered keymaps in keeb

Date: 2026-11-17 · Status: proposed · App: keeb (touchtype) · Size: small–medium change, one feature

## Intent and the why

Michael types on a Moergo Go60 running a Gallium-style layered keymap (`~/workspace/keymaps/go60-36.json`:
Main / Sym / NavNum / Fn / mouse / Magic). keeb today teaches characters against a flat, single-layer
keymap, so the app cannot show him where the layer characters live or route lessons through his real
layout. He wants to practise the layout he actually uses, on the board he actually owns.

## Goals

- Import a MoErgo-layout-editor (keycap) JSON with **all** layers, not just layer 0.
- Draw one static visualization in which every key shows the characters of every layer it carries,
  colour-coded by layer ("the keycap legend" model, chosen over a layer-switching view).
- When the lesson targets a character, highlight the key **and** the specific legend glyph, tinted with
  the target's layer colour, so the colour itself hints which layer to activate.
- Route each character to exactly one key+layer using a "closest to home" rule, so layer characters
  (home-row numbers via NavNum) get taught instead of the reach-row duplicates.

## Non-goals

- Verifying that the learner physically used the right layer: the browser only reports the produced
  character, never which layer key was held. Accepted; the visual hint is the teaching mechanism.
- Modelling hold-taps, combos and conditional layers in the visualization. Their tap characters render
  as if plainly bound on that layer.
- Sharing layered keymaps through atproto records (a schema change; file import stands alone).
- Changing the lesson algorithm (`docs/spec.md` ladder/lesson generation) beyond character→key routing.

## Anti-goals

- A board that reads as a multicolour noise wall: neutral base glyphs, small corner glyphs, and only the
  lit key carrying saturated colour.
- Any hex colour, custom font or radius in app code — the kit style guide forbids it and its tests fail.

## Constraints found in the code

- `src/layout/keycap.ts` already parses this exact format but keeps `layers[0]` only.
- `resolve()` (`src/keyboard/resolve.ts`) builds `byChar: Map<char, keyId>` — single route per char.
- `view.ts` draws one `<text>` per key; stats/engine attribute timing to the expected physical key.
- Kit tokens only: `--primary` marks the one thing to look at; series colours are `--chart-1…4`;
  state is never colour alone (legend carries names).

## Approaches considered

1. **Layer-switching view** (board flips to the layer the target lives on; infer current layer from
   typed characters). Rejected: needs invented state, flickers between characters, and hides the routes
   the learner is trying to memorise.
2. **All-layers legend view** (chosen, Michael's proposal): one static map, colour-coded glyphs.
   No state to track; the map looks like the printed keycaps/Gallium diagrams he already studies.
3. Separate "layer drill" mode with transition funnels. Deferred — routing + colour inside the normal
   lesson covers the learning need; a drill mode is a possible later feature.

Routing alternatives: A. base-wins vs **B. closest-to-home (chosen)**. B means `7` routes to NavNum at
home position, not the number row; duplicates elsewhere still render (they are the map) but the lit
route is B's choice.

## Colour calls (kit-compliant)

- Main-layer characters: `--text-primary`, centre, large — exactly as today, so an ordinary keymap looks unchanged.
- 2nd/3rd/4th character-bearing layer, in file order: `--chart-2`, `--chart-3`, `--chart-4`, small, corner positions.
  (`--chart-1` stays out because it is near-`--primary` amber and would compete with the lit key.)
- Lit key on a layer route: key fill in that layer's colour, its target glyph enlarged at full opacity,
  other glyphs dimmed. Base-route lit key keeps today's `--primary` fill. Miss stays `--accent`.
- 5th+ character layers (none exist in practice): `--text-secondary`, legend says "other layers".
- Legend under the board: swatch + layer name, `.label` styling; when the target is on a layer, a one-line
  hint in the layer colour: `Sym · hold Sym, press J`.

## Data model (my call)

`Keymap` gains optional `layers?: { name: string; byKeyId: Record<string, string> }[]`. Absent = today's
behaviour; built-in and stored keymaps need no migration. `resolve()` gains `routes: Map<char, {keyId, layer}>`
computed by: candidates = all (key, layer) pairs producing the char; pick by (taught-row first, then
distance from key centre to its hand's home-row centre, then lower layer index, then lower matrix position).
`byChar` stays as the key id for each route so the engine is untouched. Stats stay per physical key.

## What the builder still owns

Exact legend glyph placement per key size, the distance metric's formula, import-UI copy, and test layout.
`docs/spec.md` gets a §on layers and routing; spec contract updated with the implementation.
