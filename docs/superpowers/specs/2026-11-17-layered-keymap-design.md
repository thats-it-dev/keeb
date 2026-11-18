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
  the target's layer colour, and ring the physical **layer key** in that same colour so the screen shows
  the whole route: hold this, press that. The hint names the layer key (`hold Sym · Enter`).
- Route each character to exactly one key+layer using a "closest to home" rule, so layer characters
  (home-row numbers via NavNum) get taught instead of the reach-row duplicates.
- Teach the layer characters: unlocked digits/symbols enter the lesson lines through their routes.

## Non-goals

- Verifying that the learner physically used the right layer: the browser only reports the produced
  character, never which layer key was held. Accepted; the visual hint is the teaching mechanism.
- Modelling combos and conditional layers as hint routes. Hold-taps are parsed (they *are* the layer keys);
  a layer's tri-layer conditional (`if-layers <1 2>` → Fn) is recorded in the model but never hinted or used
  as the route. Tap characters of hold-taps render as if plainly bound on that layer.
- ~~Sharing layered keymaps through atproto records~~ — brought into scope by plan task 7: `char.layer`,
  `charMap.layerNames` and `charMap.layerKeys` are additive optional fields, and a record written before
  them reads as exactly the single-layer layout it always did.
- Rebuilding the lesson algorithm. The ladder, unlock-on-best-confidence rule and word generator stay as
  `docs/spec.md` describes; the curriculum simply accepts more characters and can place them as tokens.

## Anti-goals

- A board that reads as a multicolour noise wall: neutral base glyphs, small corner glyphs, and only the
  lit key carrying saturated colour.
- Any hex colour, custom font or radius in app code — the kit style guide forbids it and its tests fail.

## Constraints found in the code

- `src/layout/keycap.ts` already parses this exact format but keeps `layers[0]` only.
- Layer keys are not a separate JSON section, they are bindings inside the layers. In `go60-36.json`
  all three live on layer 0's thumb positions: `&lt 3 TAB` (Fn), `&lt 1 RET` (Sym), `&lt_bspc 2 BSPC`
  (NavNum, a custom hold-tap defined in `custom_defined_behaviors` with `bindings = <&mo>, <&kp>`).
  The file's top-level `holdTaps`/`combos` arrays are empty; parsing must not rely on them.
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

`Keymap` gains optional `layers?: { name: string; byKeyId: Record<string, string> }[]` and
`layerKeys?: { layer: number; keyId: string; activation: "momentary" | "hold-tap" | "toggle";
tapChar?: string }[]`. The parser recognises `&mo N`, `&df N`, `&lt N K`, and custom behaviours whose
`custom_defined_behaviors` definition resolves `&mo`/`&kp` (regex over that block, then follow the
binding's params). Absent = today's behaviour; built-in and stored keymaps need no migration.
`resolve()` gains `routes: Map<char, {keyId, layer}>` computed by: candidates = all (key, layer) pairs
producing the char; pick by (taught-row first, then distance from key centre to its hand's home-row
centre, then lower layer index, then lower matrix position). `byChar` stays as the route's key id.

## The layer key in the UI (Michael's finding 1)

One layer may have several keys (this file has one each). The hint/light picks the binding found on the
base layer; if several, the outermost-column (thumb) one. While the target is on a non-base layer:
the route key fills solid in the layer colour (the one thing to look at), and the layer key gets a
**dashed ring in that layer's colour** — same language as today's focus ring — so the pair reads as one
route without a second solid key competing. The hint line names the physical key: `hold Sym · Enter,
press J`. Hold-tap keys keep their tap character displayed (`Enter` is still Enter when tapped).

## The ladder teaches layer characters (Michael's finding 2)

Resolved: layer characters are taught. Curriculum candidates become: characters whose route sits on a
taught key (today's letters — unchanged) **plus** characters whose chosen route is on a **non-base
layer**. Built-in one-layer keymaps therefore change not at all (a base number row is untaught and stays
out), and in the layered file `1` routes to NavNum-at-home, which is both taught and in the candidate
set. Order and unlocking follow the existing rules: corpus frequency, one at a time, on best confidence.
Generation: words stay spelled from unlocked letters; an unlocked layer character enters the line as its
own single-character token between words — at least twice per line when focused, once otherwise.
`docs/spec.md` gains the section; §12's contract list grows with it.

## Stats identity is key+layer (Michael's finding 3)

`StatMap` keys become route ids `"L<layer>:<keyId>"`; base-layer strokes record `L0:<keyId>`. Route ids
stay opaque strings through `stats.ts` (`observe`, `mergeAll`, `confidence` are untouched). Migration on
load: an id with no `L:` prefix is read as `L0:` + id, so existing IndexedDB history lands on the base
routes. The engine charges the expected character's **route**, not the bare key, so `t` on Main and `7`
on NavNum at the same physical key keep separate confidences and the ladder sees them apart. Insight
rows display `7 · NavNum` style labels (layer name for non-base, plain for base).

## What the builder still owns

Exact legend glyph placement per key size, the distance metric's formula, import-UI copy, and test layout.
`docs/spec.md` gets a §on layers and routing; spec contract updated with the implementation.
