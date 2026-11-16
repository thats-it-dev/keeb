# Keeb Layered Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a ZMK keyboard JSON with N layers, render the board from the active layer, and highlight (not print) the layer-switch key when the lesson target lives on a different layer.

**Architecture:** The keycap importer reads every layer of `file.layers` into `keymap.layers` (chars in matrix order) and detects layer-switch keys (`&lt N`, `&lt_bspc N`, `&trans`) into `keymap.layerKeys`. `resolve()` copies those into `Resolved` plus a physical-key-name → layer-key map. The engine owns `activeLayer`; pressing a detected layer key (e.g. "Alt" on a Go60) switches it. The board view gets `layer` and `hintId` props: it renders `layers[layer]` chars and draws an accent ring on `hintId`.

**Tech Stack:** TypeScript, lit web components (kit), vitest unit tests, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-16-keeb-layers-design.md`

## Global Constraints

- Node >= 22.18, TypeScript 5.9, lit 3.3, vitest 5.0, Playwright 1.64.
- Built-in keymaps carry no `layers` field: every code path must fall back to the existing row-grid/label behavior when `keymap.layers` is undefined.
- The lesson keeps drawing its letters from layer 0 (base layer); layers only change what the board displays and which key to hint.
- One key per task step; run the relevant test right after each implementation step.

## Review Focus

- A keycap file with fewer `layer_names` than `layers` (the uploaded go60-36.json has 6 layers, 6 names — but a user file could have 6 layers and 4 names): names array is shorter → pad with `Layer N`.
- A layer key press that is also a normal character key (`&lt_bspc`: tap = space, hold = layer 2). The browser cannot tell tap from hold, so a press of that key types space (existing behavior); hold-to-layer is a known limitation, not a bug.
- Two keys sharing a label (e.g. two "Fn" keys on a Go60): `byLabel` must not conflate them — build the physical-key map only from detected layer keys, so a collision can't mis-route a press.
- `&trans` bindings on non-base layers point back to layer 0: detection must record `toLayer: 0` for `&trans`.
- A keymap with `layers` but no detectable layer keys: `hintId` stays empty, board still renders the active layer's chars.

---

### Task 1: Import all layers from a keycap file

**Files:**
- Modify: `src/keyboard/types.ts` (Keymap type)
- Modify: `src/layout/keycap.ts` (`keymapFromKeycap`)
- Test: `test/keycap.test.ts`
- Create: `test/fixtures/go60-36.json` (copy of `/home/michael/.config/pi-web/uploads/01a1e620-dcf5-70e6-be04-14ecf70b2c15/go60-36.json`)

**Interfaces:**
- Produces:
  - `Keymap.layers?: string[][]` — `layers[i][j]` is the typed char for matrix position `j` on layer `i`; `""` when the position types nothing.
  - `Keymap.layerNames?: string[]`
  - `Keymap.layerKeys?: LayerKey[]` with `LayerKey = { keyId: string; toLayer: number; action: "tap" | "hold" }`
  - `charOfBinding()` unchanged.

- [ ] **Step 1: Copy the fixture and write failing tests**

```ts
// test/keycap.test.ts — new describe block
const big = JSON.parse(readFileSync(new URL("./fixtures/go60-36.json", import.meta.url), "utf8")) as Fixture;

it("imports every layer", () => {
  const { keymap, layerNames, problems } = keymapFromKeycap(big, GO60);
  expect(problems).toEqual([]);
  expect(keymap!.layers).toHaveLength(6);
  expect(layerNames).toEqual(["Main", "Sym", "NavNum", "Fn", "mouse", "Magic"]);
});

it("detects layer-switch keys", () => {
  const { keymap } = keymapFromKeycap(big, GO60);
  const keys = keymap!.layerKeys;
  expect(keys).toEqual([
    { keyId: "R_T3", toLayer: 3, action: "tap" },   // &lt 3
    { keyId: "R_T1", toLayer: 1, action: "tap" },   // &lt 1
    { keyId: "R_T2", toLayer: 2, action: "hold" },   // &lt_bspc 2
  ]);
});

it("maps &trans back to the base layer", () => {
  const { keymap } = keymapFromKeycap(big, GO60);
  const trans = keymap!.layerKeys.filter((k) => k.toLayer === 0);
  expect(trans.length).toBeGreaterThan(0); // &trans on layers 1-5
});
```

Run: `npm test -- test/keycap.test.ts`
Expected: FAIL — `keymap.layers` and `keymap.layerKeys` are undefined.

- [ ] **Step 2: Extend the Keymap type**

In `src/keyboard/types.ts`, add to `Keymap`:

```ts
export type LayerKey = { keyId: string; toLayer: number; action: "tap" | "hold" };
// in Keymap:
layers?: string[][];
layerNames?: string[];
layerKeys?: LayerKey[];
```

- [ ] **Step 3: Import all layers in keycap.ts**

In `keymapFromKeycap`, replace the layer-0-only read: build `layers` from every `file.layers` entry (map each binding through `charOfBinding`, `""` when it returns undefined), pad `layerNames` with `Layer N` when short, and detect layer keys:

- `&lt <n>` → `{ keyId: base.keys[i].id, toLayer: n, action: "tap" }`
- `&lt_bspc <n>` (or any `&lt*` custom behavior with a numeric layer param) → `{ keyId, toLayer: n, action: "hold" }`
- `&trans` → `{ keyId, toLayer: 0, action: "tap" }`

Keep the existing rows derivation from layer 0 untouched.

- [ ] **Step 4: Run tests to make them pass**

Run: `npm test -- test/keycap.test.ts`
Expected: PASS. Then `npm run typecheck` — no errors.

- [ ] **Step 5: Commit**

```bash
git add src/keyboard/types.ts src/layout/keycap.ts test/keycap.test.ts test/fixtures/go60-36.json
git commit -m "feat: import all layers from a ZMK keycap file"
```

### Task 2: Resolved exposes layer data

**Files:**
- Modify: `src/keyboard/resolve.ts`
- Test: `test/resolve.test.ts`

**Interfaces:**
- Consumes: `Keymap.layers`, `Keymap.layerNames`, `Keymap.layerKeys` (Task 1).
- Produces (on `Resolved`):
  - `layers?: string[][]` — copied from the keymap
  - `layerNames?: string[]`
  - `layerKeys?: LayerKey[]`
  - `layerKeyByPhysical: Map<string, LayerKey & { label: string }>` — physical key name (label lowercased, e.g. `"alt"`) → layer key. Built only from keys listed in `layerKeys`; duplicate labels can't mis-route because non-layer keys never enter the map.

- [ ] **Step 1: Write failing tests**

```ts
// test/resolve.test.ts — resolve(go60, keymapWithLayers)
it("copies layer data into Resolved", () => {
  const r = resolve(GO60, kmap); // kmap has layers + layerKeys
  expect(r.layers).toHaveLength(6);
  expect(r.layerNames).toEqual(["Main", "Sym", "NavNum", "Fn", "mouse", "Magic"]);
  expect([...r.layerKeyByPhysical.keys()]).toEqual(["alt", " ", "enter"]); // labels from GO60 geometry
});
```

Run: `npm test -- test/resolve.test.ts`
Expected: FAIL — fields don't exist.

- [ ] **Step 2: Extend `Resolved` and `resolve()`**

Add the four fields to the `Resolved` type and populate them in `resolve()`. For `layerKeyByPhysical`: look up each `layerKeys` entry's key via `g.keys` index → key id → `keyLabel` (existing label, e.g. `"Alt"` → `"alt"`), store `{ keyId, toLayer, action, label }`.

- [ ] **Step 3: Run tests**

Run: `npm test -- test/resolve.test.ts` then `npm run typecheck`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/keyboard/resolve.ts test/resolve.test.ts
git commit -m "feat: expose layer data on Resolved"
```

### Task 3: Board renders the active layer and hints the layer key

**Files:**
- Modify: `src/keyboard/view.ts`
- Test: `e2e/keeb.spec.ts` (new test at the end)

**Interfaces:**
- Consumes: `Resolved.layers`, `Resolved.layerKeys` (Task 2).
- Produces (on `TtKeyboard`):
  - `layer = 0` — which layer's chars to display
  - `hintId = ""` — key id to highlight with the hint ring

- [ ] **Step 1: Add `layer` and `hintId` props, layer-aware char, hint ring**

In `TtKeyboard`:
- Add to `static properties`: `layer: { state: true }`, `hintId: { state: true }`.
- In `#key()`: displayed char = `this.resolved.layers?.[this.layer]?.[index] || k.char` — needs the key's matrix index: build `idToIndex` map from `resolved.geometry.keys` once (e.g. a `#indexById` field built in `render()`).
- Add style `.hint rect { fill: var(--accent); stroke: var(--accent); }` and render a solid ring on the key where `k.id === this.hintId` (separate element, like the focus ring).

- [ ] **Step 2: Add an e2e test**

```ts
// e2e/keeb.spec.ts
test("shows the active layer's characters and hints the layer key", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  // open settings, upload the 6-layer fixture
  await page.locator("tk-header button[aria-label='Settings']").click();
  await page.locator("dialog input[type='file']").setInputFiles("test/fixtures/go60-36.json");
  await page.locator("dialog [aria-label='Close settings']").click();
  await ready(page);
  // on the base layer the board shows Main-layer chars
  await expect(key(page, "L_C5R2")).toContainText("Q");
  // press the layer key (Alt on this board switches to layer 3 "Fn")
  await page.locator("tt-practice").press("Alt");
  await expect(page.evaluate(() => (document.querySelector("app-main") as unknown as { lastId: string }).lastId)).resolves.toBe("R_T3");
  await expect(key(page, "L_C5R2")).not.toContainText("Q"); // the Fn layer maps that position differently
  // hint: target char lives on the base layer, board is on layer 3 → a &trans key gets highlighted
  await expect(page.locator("tt-keyboard g.hint").first()).toBeVisible();
});
```

Run: `npm run e2e:one -- e2e/keeb.spec.ts`
Expected: FAIL (props not wired yet).

- [ ] **Step 3: Wire the props from `app-main`**

In `src/app-main.ts` render: `<tt-keyboard .resolved=${r} .layer=${...} .hintId=${...} ...>`. The `layer` value comes from the practice pane's engine (Task 4); until then wire `0`.

- [ ] **Step 4: Run e2e**

Run: `npm run e2e:one -- e2e/keeb.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/keyboard/view.ts src/app-main.ts e2e/keeb.spec.ts
git commit -m "feat: board renders active layer and hints the layer key"
```

### Task 4: Engine tracks the active layer

**Files:**
- Modify: `src/lesson/engine.ts`
- Modify: `src/lesson/practice.ts`
- Modify: `src/app-main.ts` (`#onKey` filter)
- Test: `test/lesson.test.ts`

**Interfaces:**
- Consumes: `Resolved.layerKeys`, `Resolved.layerKeyByPhysical` (Task 2).
- Produces:
  - `Engine.layer: number` (default 0)
  - `press()` on a layer key: set `engine.layer = toLayer`, return `{ accepted: true, targetId: "", pressedId: layerKey.keyId, ... }` (a consumed press, no stat, no error)
  - `TtPractice.layer` / `TtPractice.hintId` getters for the board props

- [ ] **Step 1: Write failing engine tests**

```ts
// test/lesson.test.ts
it("pressing a layer key switches the active layer", () => {
  const r = resolve(GO60, kmapWithLayers);
  const course = { resolved: r, targetCpm: 200 };
  let e = start(course, {});
  expect(e.layer).toBe(0);
  const res = press(course, e, "Alt", 0); // GO60's R_T3 is the &lt 3 key
  expect(res.engine.layer).toBe(3);
  expect(res.accepted).toBe(true);
  expect(res.targetId).toBe("");
});

it("keeps typing when the active layer has the target char", () => {
  // after switching to a layer, the lesson line still comes from the base layer's letters
});
```

Run: `npm test -- test/lesson.test.ts`
Expected: FAIL — `Engine` has no `layer`.

- [ ] **Step 2: Add `layer` to the engine**

In `engine.ts`: add `layer: number` to the `Engine` type and initialize `layer: 0` in `start()`/`place()`. In `press()`, before the char-comparison path: map `typed` via `course.resolved.layerKeyByPhysical`; if found, return a consumed result with `engine.layer = lk.toLayer`.

- [ ] **Step 3: Let layer keys through `#onKey`**

In `src/app-main.ts` `#onKey`: before the `e.key.length !== 1` filter, check `r.layerKeyByPhysical.has(e.key.toLowerCase())` — if it's a layer key, call `this.#type(e.key)` and return. This matters because `e.altKey`/`e.metaKey` would otherwise swallow "Alt"/"Shift" presses.

- [ ] **Step 4: Expose `layer` and `hintId` on the practice pane**

In `practice.ts`:
- `get layer()` → `this.engine?.layer ?? 0`
- `get hintId()`: target char = `engine.text[engine.index]`; find a layer where that char is defined in `resolved.layers`; if that layer ≠ active layer, the hint is the layer key that switches to it (from `resolved.layerKeys` — e.g. a `&trans` key on the active layer targets layer 0). If the char is defined on the active layer, `hintId = ""`.

- [ ] **Step 5: Run tests + e2e**

Run: `npm test -- test/lesson.test.ts` then `npm run e2e:one -- e2e/keeb.spec.ts`
Expected: PASS.

- [ ] **Step 6: Wire board props in app-main render**

`<tt-keyboard .resolved=${r} .layer=${this.#practice?.layer ?? 0} .hintId=${this.#practice?.hintId ?? ""} ...>`

- [ ] **Step 7: Commit**

```bash
git add src/lesson/engine.ts src/lesson/practice.ts src/app-main.ts test/lesson.test.ts
git commit -m "feat: engine tracks the active layer and board hints the layer key"
```

### Task 5: Full verification

- [ ] **Step 1: Run the pre-commit gate**

Run: `npm run verify`
Expected: typecheck, unit tests, lint, e2e all green. (Known flake: the full e2e suite can time out under parallel load — if only full-run timeouts fail on base too, re-run with `npm run e2e:one -- e2e/keeb.spec.ts` as the reliable check.)

- [ ] **Step 2: Commit any fixes**

```bash
git add -A && git commit -m "test: green verification"
```
