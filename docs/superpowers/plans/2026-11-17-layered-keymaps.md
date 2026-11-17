# Layered Keymaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** keeb imports a multi-layer keycap JSON, draws every layer's characters on one colour-coded keycap legend, lights the target's route (key + ringed layer key + hint), and teaches the layer characters with per key+layer stats.

**Architecture:** The keycap parser keeps all layers and the layer keys instead of only layer 0. `resolve()` gains a route model — each character routes to exactly one (key, layer) by a taught-row-first / closest-to-home ranking. The lesson ladder and engine address stats by route id (`keyId` for base, `keyId.layer` for layers), and `tt-keyboard` renders multi-glyph keycaps with kit chart-colour layer coding.

**Tech stack:** TypeScript, Lit (from `https://kit.thatsit.app/lit.js`), vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-layered-keymap-design.md` (approved in PR #31)

## Global Constraints

- Kit style guide: no hex colours, font families or radii in app code; only the documented tokens; layer colours are `--chart-2/3/4` (`--chart-1` deliberately unused), base-route lit key stays `--primary`, miss `--accent`.
- Stat route ids: `routeId(layer, keyId) = layer === 0 ? keyId : \`${keyId}.${layer}\``. A bare `keyId` *is* the base route — no data migration anywhere.
- Layer indices are file-order and stable: dropping a characterless layer from the model must not renumber the survivors.
- `Keymap.rows`/`byKey` semantics are unchanged; built-in and one-layer keymaps must render byte-identical SVG and keep every existing test green.
- Import validation (board name, binding count, matrix-order check) stays on layer 0 only.
- atproto records change not at all: stat ids already travel as opaque strings.
- Test commands: `npm test` (vitest), one file: `npx vitest run test/keycap.test.ts`. e2e is flaky under parallel load — run `npm run e2e:one -- e2e/<spec>.spec.ts` while iterating; `npm run verify` is the full gate.

## Review Focus

Behaviours no single task's tests would catch that a real keymap will exercise — each gets a test in the owning task:

1. A keymap imported before this change (no `layers`) behaves exactly as today: single centre glyph, all stat ids bare.
2. Old progress loads unchanged: bare ids are base routes; a learner's existing confidences land on the same keys after routes are computed.
3. A character on three layers (digit `7`) resolves to the same route on every reload and on every screen — ranking must not depend on object iteration order.
4. A custom hold-tap declared in `custom_defined_behaviors` (`&lt_bspc 2 BSPC`) is recognised as the NavNum layer key, and unknown `&custom` names still produce no character.
5. A file whose layer 0 is scrambled is refused even when its later layers are well-formed (validation never consults them).

## File Structure

- Modify `src/keyboard/types.ts` — `KeymapLayer`, `LayerKey`, `Keymap.layers/layerKeys`, `RenderKey.glyphs`.
- Modify `src/layout/keycap.ts` — parse all layers + layer keys; `KeycapFile.custom_defined_behaviors`.
- Create `src/keyboard/routes.ts` — the B ranking: candidates in, `Route[]` out (kept out of `resolve.ts` so the algorithm is testable alone).
- Modify `src/keyboard/resolve.ts` — assemble routes, `byStat`, `layerNames`, `layerKeyOf`, per-key glyphs.
- Modify `src/keyboard/view.ts` — multi-glyph keycaps, layer colour classes, route highlight + ring.
- Modify `src/stats/stats.ts` — `routeId`/`routeLayer`/`routeKey`.
- Modify `src/lesson/engine.ts`, `src/lesson/ladder.ts`, `src/lesson/generator.ts` — route-addressed stats, layer-char curriculum, token insertion.
- Modify `src/app-main.ts`, `src/lesson/practice.ts`, `src/stats/format.ts`, `src/stats/panel.ts` — hint line, `route` binding, route labels.
- Create `test/fixtures/go60-layers.json`; extend `test/keycap.test.ts`, `test/resolve.test.ts`, `test/routes.test.ts`, `test/stats.test.ts`, `test/ladder.test.ts`, `test/generator.test.ts`, `e2e/layout.spec.ts`, `e2e/practice.spec.ts`; update `docs/spec.md`.

---

### Task 1: Keycap parser keeps all layers and the layer keys

**Files:**
- Modify: `src/keyboard/types.ts` (after `KeymapRow`, ~line 54)
- Modify: `src/layout/keycap.ts`
- Create: `test/fixtures/go60-layers.json`
- Test: `test/keycap.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type KeymapLayer = { index: number; name: string; byKeyId: Record<string, string> };
  export type LayerKey = { layer: number; keyId: string; activation: "momentary" | "hold-tap" | "toggle" };
  // Keymap gains: layers?: KeymapLayer[]; layerKeys?: LayerKey[];
  // keycap.ts — KeycapFile gains custom_defined_behaviors?: unknown;
  export function layerKeysFrom(file: KeycapFile, base: Geometry, charsPerPosition: Map<number, Set<string>>): { entries: LayerKey[]; problems: string[] };
  ```
  `keymapFromKeycap` returns the same `KeycapImport` shape; its `keymap` now carries `layers` (one entry per file layer that produced ≥1 single character, carrying its **file index**; index 0 always present) and `layerKeys` (deduplicated per `(layer, keyId)`).
- Consumes: existing `charOfBinding` (unchanged).

- [ ] **Step 1: Write the failing tests** in `test/keycap.test.ts` against a new fixture `test/fixtures/go60-layers.json` — copy `go60-keycap.json`, set `keyboard: "go60"`, `layer_names: ["Main","Sym","NavNum","Fn"]`, give layers 1–2 full 60-length binding arrays built on `{"value":"&kp","params":[{"value":"<CODE>"}]}` with digits `N1..N0` on the home-row positions of layer 2 and punctuation on layer 1, and layer 3 a full array of `{"value":"&trans"}`, leave layer 0 as-is except positions 56/58/59 become `{"value":"Custom","params":[{"value":"&lt 3 TAB"}]}`, `{"value":"Custom","params":[{"value":"&lt 1 RET"}]}`, `{"value":"Custom","params":[{"value":"&lt_bspc 2 BSPC"}]}`, and add `custom_defined_behaviors` containing
  ```
  hold_taps { lt_bspc { compatible = "zmk,behavior-hold-tap"; bindings = <&mo>, <&kp>; } }
  ```
  Tests: (a) `keymap.layers` has entries `{index:0},{index:1},{index:2}` with names and a `byKeyId["L_C5R3"] === "1"`-style digit on the left home key of layer 2; (b) `keymap.layerKeys` equals `[{layer:3,…56's keyId,activation:"hold-tap"},{layer:1,…,activation:"hold-tap"},{layer:2,…,activation:"hold-tap"}]` by position → id of `GO60.keys`; (c) a `&mo`-style binding `{"value":"Custom","params":[{"value":"&mo 1"}]}` yields `activation:"momentary"`; (d) Review Focus 5: reversing layer 0 (existing test's trick) refuses the file even though layers 1–2 are valid; (e) Review Focus 4: a `Custom` binding naming an *undeclared* behaviour yields no character and no layer key.

- [ ] **Step 2: Run `npx vitest run test/keycap.test.ts`** — expect FAIL (new types/functions absent).

- [ ] **Step 3: Implement.** In `keymapFromKeycap`, loop all file layers with the existing per-layer binding→char walk (same count/order rules; the matrix-order and count checks run on layer 0 before any later layer is read). Build `byKeyId` per layer from `base.keys[i].id`. For `layerKeysFrom`: tokenise each binding via a new `customTokens(b): string[]|undefined` that returns `[]`-or-tokens only for `value` `"Custom"`/`"&kp Custom"`, match `/^&(lt|mo|df)\s+(\d+)(?:\s+(\w+))?$/i` and `/^&(\w+)\s+(\d+)\s+(\w+)$/i` where `\w+` names a `zmk,behavior-hold-tap` extracted from `custom_defined_behaviors` by `/(\w+):\s*\w*\s*\{[^}]*compatible\s*=\s*"zmk,behavior-hold-tap"[^}]*bindings\s*=\s*<&mo>,\s*<&kp>/g`.

- [ ] **Step 4: Run `npm test`** — expect PASS, zero existing tests edited except fixture-independent ones.

- [ ] **Step 5: Commit** `feat(keycap): import every layer and the layer keys`

---

### Task 2: Route model in resolve

**Files:**
- Create: `src/keyboard/routes.ts`
- Modify: `src/keyboard/resolve.ts`, `src/keyboard/types.ts` (`RenderKey.glyphs`)
- Test: `test/routes.test.ts` (new), `test/resolve.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // routes.ts
  export type Route = { char: string; keyId: string; layer: number; statId: string };
  export type Candidate = { char: string; keyId: string; layer: number; taught: boolean; distanceToHome: number; matrixIndex: number };
  export function pickRoutes(candidates: Candidate[]): Route[];
  // resolve.ts — Resolved gains:
  routes: Route[];                       // sorted by char.localeCompare, one per character
  routeChars: Map<string, Route>;        // lowercased char -> Route
  byStat: Map<string, Route>;            // statId -> Route
  layerNames: string[];                  // index = file layer index; gaps = ""
  layerKeyOf: Map<number, string>;       // layer -> keyId of the primary layer key (base-layer binding, then lowest matrix index)
  // RenderKey gains glyphs: { char: string; layer: number }[] (empty for label-only keys; base char first)
  ```
  `distanceToHome` is Euclidean from the key centre to its hand's home-row centre (`rowRoles` role `home`, `col >= 1`); keys with no hand match fall back to `Infinity`'s neighbour: same-hand absent ⇒ other hand. `byChar` keeps its current meaning: `char -> route.keyId`.
- Consumes: Task 1's `Keymap.layers`/`layerKeys`; existing `charFor`, `isTaught`, `bounds`.

- [ ] **Step 1: Write the failing tests.** In `test/routes.test.ts`: ranking tests on hand-built candidates — taught beats untaught; within taught, smaller distance wins (`"1"` NavNum home key beats Main number row, Review Focus 3 with three layers included); tie → lower layer; tie → lower matrixIndex; output sorted and deterministic when candidates arrive shuffled (run the pick twice on a permuted array and compare). In `test/resolve.test.ts`: (a) resolve of `GO60` + layered keymap (built inline like Task 1's fixture) exposes `routeChars.get("7").layer === 2`, `layerNames[1] === "Sym"`, `byStat.get("L_C5R3.2").statId`, `layerKeyOf.get(1)` = the Enter thumb's keyId; (b) Review Focus 1: resolving a built-in keymap yields `routes` all `layer: 0`, `statId === keyId`, identical `byChar` entries to today (assert against the existing map), and every `glyphs` array length ≤ 1.

- [ ] **Step 2: Run `npx vitest run test/routes.test.ts test/resolve.test.ts`** — expect FAIL.

- [ ] **Step 3: Implement.** `pickRoutes`: group candidates by `char`, sort each group with comparator `taught desc, distanceToHome asc, layer asc, matrixIndex asc, keyId localeCompare` (the last term is what makes Review Focus 3 true), take head, `statId = routeId(layer, keyId)` — import from `../stats/stats.ts` if added early, else inline the same formula and switch to the import in Task 3. In `resolve()`: iterate all keys × `keymap.layers` (`layers[0]` from the existing `charFor` result) collecting single-char bindings as candidates; attach `glyphs` per key (base first, then layers in index order); build the four maps; leave the existing taught/duplicate-problem loop intact (a duplicate across layers is not a "two keys" problem — only same-layer duplicates are).

- [ ] **Step 4: Run `npm test`** — expect PASS.

- [ ] **Step 5: Commit** `feat(keyboard): per-character route model`

---

### Task 3: Route ids for stats and the engine

**Files:**
- Modify: `src/stats/stats.ts`, `src/lesson/engine.ts`
- Test: `test/stats.test.ts`, `test/lesson.test.ts` (engine tests live here)

**Interfaces:**
- Produces:
  ```ts
  // stats.ts
  export function routeId(layer: number, keyId: string): string; // layer === 0 ? keyId : `${keyId}.${layer}`
  export function routeLayer(statId: string): number;            // /\.(\d+)$/ suffix, else 0
  export function routeKey(statId: string): string;              // suffix stripped
  ```
  Engine: `press` records its stroke under `course.resolved.routeChars.get(char)?.statId ?? targetId`; `pending`/`targetId`/`pressedId` keep meaning bare `keyId`s (highlighting is physical).
- Consumes: Task 2's `Resolved.routeChars`.

- [ ] **Step 1: Write the failing tests.** stats.ts: round-trip `routeId`/`routeLayer`/`routeKey` incl. base identity `routeId(0,"L_C5R3") === "L_C5R3"` (Review Focus 2) and suffix parsing of ids without dots. engine (in `test/lesson.test.ts`): with a layered `Course`, pressing the target digit writes `stats["<keyId>.2"]` and leaves `stats["<sameKeyId>"]` (the letter's) untouched; a *wrong* key press charges the expected character's route with an error; base-layer letter strokes still land on the bare keyId.

- [ ] **Step 2: Run `npx vitest run test/stats.test.ts test/lesson.test.ts`** — expect FAIL.

- [ ] **Step 3: Implement** the three helpers in `stats.ts` and the one-line `press` change in `engine.ts` (both the correct-stroke and the error path go through the same `recordStroke`; only the map key changes). Replace any duplicated `routeId` formula from Task 2 with the import.

- [ ] **Step 4: Run `npm test`** — expect PASS; `stats.test.ts` must still pass every pre-existing case unedited.

- [ ] **Step 5: Commit** `feat(stats): stat identity becomes key+layer`

---

### Task 4: The ladder teaches layer characters

**Files:**
- Modify: `src/lesson/ladder.ts`, `src/lesson/engine.ts`, `src/lesson/generator.ts`
- Test: `test/ladder.test.ts`, `test/generator.test.ts`

**Interfaces:**
- Produces:
```ts
// ladder.ts — teachingOrder now returns stat ids:
export function teachingOrder(r: Resolved, keyboardOrder: boolean): string[];
// candidates: route.layer > 0, OR (/^[a-z]$/i.test(char) && that key taught)  — deduped by char via Resolved.routes
// frequency sort keeps corpus letters first; layer chars rank equal at freq.length and tie by char code point
// engine.ts place():
// lesson({ letters, tokens, focus, stats, targetCpm, ids, realWords, seed })
// generator.ts — LessonInput gains tokens?: string[];
// each token lands as a standalone word ≥ once per line, the focused char's token ≥ twice; words are spelled from `letters` only
```
- Consumes: Task 2 `Resolved.routes`/`byStat`, Task 3 route ids.

- [ ] **Step 1: Write the failing tests.** ladder: with a layered `Resolved` and empty stats, `order` starts with the six corpus letters (existing expectations untouched — built-in maps unchanged, Review Focus 1) and contains `"…keyId.2"` entries for the digits after all letters; unlock walks the same rule (assert `unlocked` grows when every included route's `best >= 1`); `focus` can be a layer route. generator: `tokens: ["1","7"]` with a focused `"7"` produces text whose split-on-space contains `"1"` ≥ once and `"7"` ≥ twice, all other words still pure letters, and same seed ⇒ same line.

- [ ] **Step 2: Run `npx vitest run test/ladder.test.ts test/generator.test.ts`** — expect FAIL.

- [ ] **Step 3: Implement.** In `ladder()`, replace the `r.byId.get(id)!` char/stat lookup with `r.byStat.get(id)!`. In `teachingOrder`, build candidates from `r.routes` per the rule above (keyboardOrder cost uses the route key's geometry). In `place()`, split `l.unlocked` into letter chars (→ `letters`) and layer routes (→ `tokens`), and pass `focus` unchanged; when focus is a token, exclude it from word `need`. In `generator.ts`, after the existing gap-fill loop, insert remaining token appearances at rng-chosen slots.

- [ ] **Step 4: Run `npm test`** — expect PASS (all 26 letter-era tests unchanged; engine tests from Task 3 still green).

- [ ] **Step 5: Commit** `feat(lesson): teach the layer characters`

---

### Task 5: The layered board — glyphs, colours, route light, ring

**Files:**
- Modify: `src/keyboard/view.ts`, `src/lesson/practice.ts`, `src/app-main.ts`
- Test: `e2e/keeb.spec.ts` (or `practice.spec.ts` — whichever renders the board today), `test/resolve.test.ts` untouched

**Interfaces:**
- Produces: `TtKeyboard` gains property `route?: { keyId: string; layer: number; ringId: string; char: string }` (set alongside `active`). `practice.ts` gains `get pendingRoute(): Route | undefined` = `resolved.routeChars.get(want char)` with `ringId` from `resolved.layerKeyOf`; `app-main` binds `.route=${this.practice.pendingRoute}` on `tt-keyboard`. Glyph layout: base glyph centre `34px` as today; layer glyphs `20px` in slots top-left, top-right, bottom-left by layer order; a key with only one glyph renders the current single `<text>` markup unchanged. Layer colour classes: `.g.ly1`, `.k.on.lyN rect` use `--chart-2/3/4`; `N ≥ 3` and `--chart` exhausted → `--text-secondary`; route glyph on the lit key gets `.gok` (full opacity, `40px`), sibling glyphs `.k.on .g:not(.gok)` drop to `opacity: .35`; the ring key renders `<rect class="routering">` — dashed stroke, the route layer's colour, same shape language as `.ring`.
- Consumes: Task 2's `RenderKey.glyphs`, `Resolved.routeChars`, `layerKeyOf`.

- [ ] **Step 1: Write the failing e2e tests** in the spec that already drives practice: import the layered fixture board (mirror `e2e/layout.spec.ts`'s import flow), start a line whose pending char is a NavNum digit, assert: the target key has class `on ly2` (or equivalent resolved colour), a second key carries `routering`, the digit's `<text>` carries `gok`, and a base letter still renders exactly the old markup (`getByText` of one letter per taught key).

- [ ] **Step 2: Run `npm run e2e:one -- e2e/<spec>.spec.ts`** — expect FAIL on the new cases.

- [ ] **Step 3: Implement** in `view.ts#key`: map `k.glyphs` (fall back to `[k.char]` when empty via existing code path), compute classes from `this.route?.keyId === k.id` and its `layer`, keep `active`/`missed`/`focusId` behaviour byte-identical for one-glyph keys. Add the `pendingRoute` getter in `practice.ts` and the `.route` binding in `app-main.ts`.

- [ ] **Step 4: Run `npm run e2e:one` for the touched spec, then `npm test`** — expect PASS both.

- [ ] **Step 5: Commit** `feat(keyboard): all-layers keycap legend with route highlight`

---

### Task 6: Wiring — hint line, route labels, spec update

**Files:**
- Modify: `src/app-main.ts`, `src/stats/format.ts`, `src/stats/panel.ts`, `docs/spec.md`
- Test: `e2e/practice.spec.ts`, `test/format.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // app-main hint, rendered under tt-keyboard from practice.pendingRoute:
  get hint(): string;   // "" when pendingRoute is base or none
  // format.ts
  export function describeRoute(statId: string, charOf: (s: string) => string, layerName: (l: number) => string): string;
  // base -> uppercased char (as today's callers do); layer N -> `${char} · ${name}`
  ```
  Hint text, exact pattern: `hold <LayerName> · <keyLabel(layerKeyId)>, press <char>` using `keyLabel` from `view.ts`. Panel/insight rows pass `describeRoute` as their label mapper (default keeps bare ids when no route data). `docs/spec.md`: new §13 (layer import, routing rule, layer keys, stat ids, tokens) and §12 item 16 referencing it.

- [ ] **Step 1: Write the failing tests.** e2e: on a NavNum digit the hint line is visible with text `hold NavNum · Enter, press 1`-shaped content (fixture names); unit: `describeRoute("L_C5R3.2", …) === "1 · NavNum"`, `describeRoute("L_C5R3", …) === "T"`-equivalent for base, unknown suffix-free ids fall back to the raw id.

- [ ] **Step 2: Run `npx vitest run test/format.test.ts`** — expect FAIL.

- [ ] **Step 3: Implement** the getters, the `<p class="hint">` under `tt-keyboard` (styles: `.label` + layer-colour class), the panel label wiring, and the `docs/spec.md` sections.

- [ ] **Step 4: Run `npm run e2e:one -- e2e/practice.spec.ts`** — expect PASS.

- [ ] **Step 5: Commit** `feat(app): layer route hint, route labels, spec update`

---

### Task 7: Full gate

- [ ] **Step 1:** `npm run verify` (typecheck + vitest + knip + Playwright). Known flakiness: full e2e under parallel load times out on base too — if only e2e timeouts fail, rerun `npm run e2e` serially once (`npx playwright test --workers=1`) before believing a failure.
- [ ] **Step 2:** Fix, then commit `chore: layered keymaps verification fixes` (only if changes were needed).
