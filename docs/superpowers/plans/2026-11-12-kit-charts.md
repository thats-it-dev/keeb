# Kit Charts in Keeb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace keeb's hand-drawn d3/CSS charts (history chart, per-key bars, stat cards, daily bar) with the kit's published chart components.

**Architecture:** `history-section.ts` renders `tk-timeseries`; `progress-section.ts` renders `tk-bars` for keys and `tk-stats`/`tk-stat` tiles; `daily-bar.ts` renders a single-row `tk-bars`. Kit custom elements are already registered globally by `main.ts` importing `https://kit.thatsit.app/kit.js`. After the swap, d3 dependencies and all dead chart CSS are removed.

**Tech Stack:** Lit (via kit remote module), vitest (unit), Playwright (e2e, desktop project).

**Spec:** `docs/superpowers/specs/2026-11-12-kit-charts-design.md`

## Global Constraints

- Files under `src/` stay under 400 lines (`test/guardrails.test.ts` enforces).
- Kit is consumed only from `https://kit.thatsit.app/kit.js` — never from the kit repo path.
- `npm run verify` (typecheck, unit, knip lint, full e2e) must pass before every commit.
- e2e: no `page.waitForTimeout`; no pixel-size or color assertions; no `page.evaluate` into component internals (reading DOM attributes/styles is fine).
- knip fails on unused exports/files/deps — delete dead code, don't keep it.
- Commit format: `type: summary`, imperative, ≤ 72 chars.
- Run `npm run e2e:one -- e2e/<file>.spec.ts` while iterating; full e2e only in `verify`.

## Review Focus

- **A day with sessions but 0 characters** (wpm 0, `sessions > 0`): the clock line must dip to the axis, not break; the stroke line and band stay absent. Not exercised by any seeded e2e.
- **Daily goal overshoot** (`minutes > goalMinutes`): `tk-bars` fill clamps at 100% and the readout says "1 of 1 at goal" — the day still reads as finished, not over.
- **Collapsed insights pane** (width 0): `tk-timeseries`/`tk-bars` rely on ResizeObserver for width; first render happens hidden. The existing openPane e2e flow covers this, but watch for a chart that never re-renders after the pane opens.
- **Per-key bar saturation**: keys faster than goal/0.8 ms all clamp to a 100% bar (kit's reciprocal scale, unlike the old log scale). Ranking below goal still works; the e2e must not assert distinct widths for super-fast keys.
- **Demo mode** (`?demo=1`): chart must render from generated sessions and write nothing to IndexedDB.

---

### Task 1: History chart → tk-timeseries

**Parallel group:** A

**Files:**
- Modify: `src/stats/history-section.ts`
- Modify: `e2e/history.spec.ts`
- Modify: `package.json` (remove `d3-array`, `d3-scale`, `d3-shape`, `@types/d3-array`, `@types/d3-scale`, `@types/d3-shape`)
- Test: `e2e/history.spec.ts`

**Interfaces:**
- Consumes: `series(h: History, limit?: number): Point[]` from `src/stats/history.ts` (`Point = { day: string; wpm: number; strokeWpm: number; minutes: number; sessions: number }`), `buildHistory = history(rows: SessionRow[], nowMs?)`, `cpmToWpm` from `./stats.ts`, `paneSessions`, `isPreviewHost` from `./demo.ts`.
- Produces: `.hist` section containing `<tk-timeseries>` (Task 3 swaps the card grid in the same file but leaves the chart untouched).

- [x] **Step 1: Rewrite the chart assertions in `e2e/history.spec.ts`**

  Keep the seeded-data helpers (`row`, `seed`, `seedAndOpen`) unchanged. Change:

  - "cached sessions draw a curve and honest totals":
    - `expect(await page.locator(".hist .chart circle").count()).toBe(3)` →
      `expect(await page.locator(".hist .line.s1").getAttribute("d")).toContain("M")` and `expect(await page.locator(".hist .line.s2").getAttribute("d")).toBe("")` (seeded rows have no per-key stats, so the stroke line is empty).
    - `await expect(page.locator(".hist .chart .goal")).toHaveCount(1)` → `await expect(page.locator(".hist tk-timeseries .goal")).toHaveCount(1)`
    - Card assertions (`.hist .card` …) stay as-is for now (Task 3 rewrites them).
  - "a day with no sessions is a gap, not a point on a line":
    - Replace the circle-cx ratio block with:
      ```ts
      const d = (await page.locator(".hist .line.s1").getAttribute("d")) ?? "";
      expect(d.split("M").length - 1).toBe(1); // the line breaks at the 3-day hole
      expect(await page.locator(".hist .dot").count()).toBe(1); // isolated day renders as a dot
      ```
    - Drop the pixel-ratio assertion (kit's geometry is internal); the single-M + dot assertions keep the "gap, not slope" claim.
  - New test "a day with sessions but no characters dips to the axis, not a gap":
    ```ts
    test("a day with sessions but no characters dips to the axis, not a gap", async ({ page }) => {
      await seedAndOpen(page, [row({ rkey: "z1", atMs: noon(0), chars: 300 }), row({ rkey: "z2", atMs: noon(1), chars: 0 })]);
      // sessions > 0 keeps the day in the line even at 0 wpm: one continuous run, no isolated dot.
      expect(((await page.locator(".hist .line.s1").getAttribute("d")) ?? "").split("M").length - 1).toBe(1);
      expect(await page.locator(".hist .dot").count()).toBe(0);
    });
    ```
  - "a session with no readable date counts, but is not drawn":
    - `expect(await page.locator(".hist .chart circle").count()).toBe(1)` → `expect(await page.locator(".hist .dot").count()).toBe(1)`
  - "?demo=1 draws a labelled curve and stores nothing":
    - `expect(await page.locator(".hist .chart circle").count()).toBeGreaterThan(5)` →
      `expect(await page.locator(".hist .line.s1").getAttribute("d")).toContain("M")`
    - Drop the `path.trend` assertion (superseded by the line above).
  - "the chart draws the pausing, and refuses to draw it without the data":
    - Read the three paths as `s1 = .line.s1` (clock), `s2 = .line.s2` (typing), `band = .band` (all inside `.hist tk-timeseries`).
    - Keep the y-comparison: parse `y` from both `d` strings the same way as today, assert `typingY[i] < clockY[i]` and equal lengths.
    - Keep `expect(paths.s2.split("L").length).toBe(4)` (four consecutive measured days).
    - Bare case: `expect(bare.s2).toBe("")` and `expect(bare.band).toBe("")` (`.band` element absent → read `d` as `""`).
  - "the pane is a full-height shell column…": `.insights > .hist .chart` → `.insights > .hist tk-timeseries`
- [x] **Step 2: Run e2e to verify it fails**

  Run: `npm run e2e:one -- e2e/history.spec.ts`
  Expected: FAIL — no `tk-timeseries` / `.line` elements rendered.
- [x] **Step 3: Rewrite the chart in `src/stats/history-section.ts`**

  Remove the d3 imports, `CH`, `parseDay`, and the hand-built SVG + legend. The chart becomes:

  ```ts
  const goal = cpmToWpm(p.targetCpm);
  const lineSeries = [
    { y: "wpm", label: "with pauses", defined: (q: Point) => q.sessions > 0 },
    { y: "strokeWpm", label: "typing only", defined: (q: Point) => q.sessions > 0 && q.strokeWpm > 0 },
  ];
  ```
  and in the template, where the `<svg class="chart">` and `<p class="legend">` were:
  ```html
  <tk-timeseries .data=${pts} x="day" .series=${lineSeries} band="wpm strokeWpm" band-label="pausing" .goal=${goal} unit="wpm"></tk-timeseries>
  ```
  Keep: the `<h3>`, the demo-note paragraph, the card grid (Task 3's job), and the `<p class="empty">` footer (it still carries the "N day(s) practised / plus N session(s) on other boards / N session(s) had no readable date" line). The kit generates its own legend, aria summary and readout — delete the old `aria-label`.
- [x] **Step 4: Remove the d3 dependencies**

  Edit `package.json`: delete `d3-array`, `d3-scale`, `d3-shape` from dependencies and `@types/d3-array`, `@types/d3-scale`, `@types/d3-shape` from devDependencies. Run `npm install` to update the lockfile.
- [x] **Step 5: Run tests to verify they pass**

  Run: `npm run e2e:one -- e2e/history.spec.ts`
  Expected: PASS (all tests in the spec).
  Run: `npm run typecheck && npm test`
  Expected: PASS.
- [x] **Step 6: Commit**

  ```bash
  git add src/stats/history-section.ts e2e/history.spec.ts package.json package-lock.json
  git commit -m "feat: draw the history chart with kit's tk-timeseries"
  ```

---

### Task 2: Per-key bars → tk-bars

**Parallel group:** A

**Files:**
- Modify: `src/stats/progress-section.ts`
- Modify: `src/stats/overview.ts` (delete `barWidth` and `GOAL_AT`)
- Delete: `test/scale.test.ts`
- Modify: `test/overview.test.ts` (delete the `barWidth` describe block and its import)
- Test: `e2e/practice.spec.ts`

**Interfaces:**
- Consumes: `Overview.measured: KeyRow[]` (`{ id, label, ms, wpm, samples, errors, … }`), the `goalMs: number` parameter `progressSection` already receives, `wpm(msPerChar: number): number` from `./overview.ts`.
- Produces: the `.stats` section now renders `<tk-bars>` with rows `{ key: string; ms: number }` in `o.measured` order (Task 3 swaps the card grid in the same file but leaves the bars untouched).

- [x] **Step 1: Update the bar assertions in `e2e/practice.spec.ts`**

  - "the progress bars are a pane section, not a screen to navigate to": `.krow` → `tk-bars .row` (two occurrences).
  - "the progress screen names every key it measured":
    - `const nums = await page.locator(".krow .num")` → `page.locator("tk-bars .row .val")`; keep the `nums.every((n) => /wpm/.test(n))` assertion.
    - `const caps = await page.locator(".krow .cap")` → `page.locator("tk-bars .row .name")`; keep the assertions (space label non-empty, contains "space").
    - `const widths = await page.locator(".krow .kbar").evaluateAll(…)` → `page.locator("tk-bars .row .fill").evaluateAll(…)`; keep `widths.every((w) => w <= 100 && w >= 0)` (fill width 0 is possible now).
    - Keep the monotonic pairs assertion.
  - "bar widths rank a spread of timings instead of saturating":
    - Wait on `page.locator("tk-bars .row").first()` instead of `.krow`.
    - Read rows as `{ name: .row .name textContent, w: .row .fill style.width }` via `evaluateAll` on `tk-bars .row`.
    - New expectations on the kit's reciprocal scale (`clamp(0.8 * goal / ms, 0, 1)`, goal 300 ms):
      ```ts
      expect(byCap.get("a")).toBe(100); // 40 ms → clamped
      expect(byCap.get("s")).toBe(100); // 120 ms → clamped too: faster than goal/0.8 saturates
      expect(byCap.get("d")).toBe(80);  // exactly at goal → tick position
      expect(byCap.get("g")).toBeLessThan(80);
      ```
      (Assert with a small tolerance if `evaluateAll` returns floats: `Math.abs(w - expected) < 0.1`.)
    - Goal tick: `const marks = await page.locator("tk-bars .tick").evaluateAll(els => [...new Set(els.map(e => (e as HTMLElement).style.left))]); expect(marks).toEqual(["80%"]);`
    - Keep the final `.card` hasText "wpm" assertion (Task 3 changes it later).
- [x] **Step 2: Run e2e to verify it fails**

  Run: `npm run e2e:one -- e2e/practice.spec.ts`
  Expected: FAIL — no `tk-bars .row` elements.
- [x] **Step 3: Rewrite the rows in `src/stats/progress-section.ts`**

  Delete the `row` helper, the `barWidth` import, and the `<div class="rows">${o.measured.map(row)}</div>` block. Where the rows were:
  ```html
  <tk-bars .data=${o.measured.map((k) => ({ key: k.label, ms: k.ms }))} label="key" value="ms" .goal=${goalMs} unit="ms" .format=${(ms: number) => `${ms} ms · ${wpm(ms)} wpm`}></tk-bars>
  ```
  Keep: the card grid (Task 3), the focus/slowest paragraphs, the untried/still-locked chips, the empty state.
- [x] **Step 4: Delete `barWidth`/`GOAL_AT` and their tests**

  - `src/stats/overview.ts`: delete `barWidth` and `GOAL_AT` (knip will flag them as unused exports).
  - `test/scale.test.ts`: delete the file.
  - `test/overview.test.ts`: delete the `describe("barWidth", …)` block and drop `barWidth`, `GOAL_AT` from the import.
- [x] **Step 5: Run tests to verify they pass**

  Run: `npm run e2e:one -- e2e/practice.spec.ts`
  Expected: PASS.
  Run: `npm run typecheck && npm test`
  Expected: PASS.
- [x] **Step 6: Commit**

  ```bash
  git add src/stats/progress-section.ts src/stats/overview.ts test/overview.test.ts test/scale.test.ts e2e/practice.spec.ts
  git commit -m "feat: draw the per-key bars with kit's tk-bars"
  ```

---

### Task 3: Stat cards → tk-stats/tk-stat

Runs after Task 1 and 2 (shared files: both section files and both e2e files).

**Files:**
- Modify: `src/stats/progress-section.ts`
- Modify: `src/stats/history-section.ts`
- Delete: `src/ui/card.ts`
- Test: `e2e/history.spec.ts`, `e2e/practice.spec.ts`

**Interfaces:**
- Consumes: `Overview` fields (`avgWpm`, `readyPct`, `errPct`, `covered`, `total`, `handBalance`) and `History` fields (`sessions`, `chars`, `minutes`, `streak`, `best?.wpm`).
- Produces: both sections render `<tk-stats>` with `<tk-stat>` children; `src/ui/card.ts` is gone.

- [x] **Step 1: Update the card assertions in the e2e specs**

  - `e2e/history.spec.ts`: the helper `const card = (name) => page.locator(".hist .card", { hasText: name }).locator("b")` becomes
    ```ts
    const card = (name: string) => page.locator(".hist tk-stat", { hasText: name }).locator(".value");
    ```
    and expectations become: characters `1,500` (kit's `compact()` uses `Intl.NumberFormat` with no compact notation below 10 000), sessions `3`, practised `4 min`, streak `3 d`.
  - `e2e/practice.spec.ts`: the last assertion of "bar widths rank a spread…" `page.locator(".card").first()` hasText "wpm" → `page.locator("tk-stats").first()` hasText "wpm".
- [x] **Step 2: Run e2e to verify it fails**

  Run: `npm run e2e:one -- e2e/history.spec.ts && npm run e2e:one -- e2e/practice.spec.ts`
  Expected: FAIL — no `tk-stat` / `tk-stats` elements.
- [x] **Step 3: Swap the card grids**

  - `src/stats/progress-section.ts`: replace `<div class="grid">${card("average", …)} …</div>` with
    ```html
    <tk-stats>
      <tk-stat label="average" .value=${o.avgWpm} unit="wpm"></tk-stat>
      <tk-stat label="at goal" .value=${`${o.readyPct}%`}></tk-stat>
      <tk-stat label="errors" .value=${`${o.errPct}%`}></tk-stat>
      <tk-stat label="keys" .value=${`${o.covered}/${o.total}`}></tk-stat>
      <tk-stat label="hands" .value=${`${o.handBalance}/${100 - o.handBalance}`}></tk-stat>
    </tk-stats>
    ```
  - `src/stats/history-section.ts`: replace the `<div class="grid">` block with
    ```html
    <tk-stats>
      <tk-stat label="sessions" .value=${h.sessions}></tk-stat>
      <tk-stat label="characters" .value=${h.chars}></tk-stat>
      <tk-stat label="practised" .value=${h.minutes} unit="min"></tk-stat>
      <tk-stat label="streak" .value=${h.streak} unit="d"></tk-stat>
      <tk-stat label="best day" .value=${h.best?.wpm ?? 0} unit="wpm"></tk-stat>
    </tk-stats>
    ```
  - Delete `src/ui/card.ts` and its imports in both section files.
- [x] **Step 4: Run tests to verify they pass**

  Run: `npm run e2e:one -- e2e/history.spec.ts && npm run e2e:one -- e2e/practice.spec.ts`
  Expected: PASS.
  Run: `npm run typecheck && npm test && npm run lint`
  Expected: PASS (knip: `card.ts` gone, no unused exports).
- [x] **Step 5: Commit**

  ```bash
  git add src/stats/progress-section.ts src/stats/history-section.ts src/ui/card.ts e2e/history.spec.ts e2e/practice.spec.ts
  git commit -m "feat: draw stat cards with kit's tk-stats"
  ```

---

### Task 4: Daily bar → tk-bars

**Parallel group:** A

**Files:**
- Modify: `src/ui/daily-bar.ts`
- Test: `e2e/daily.spec.ts`

**Interfaces:**
- Consumes: `DailyGoal = { minutes: number; goalMinutes: number; pct: number; reached: boolean }` from `src/stats/daily.ts` (already computed by the caller).
- Produces: `dailyBar(d: DailyGoal)` renders `<div class="daily">` wrapping a single-row `<tk-bars>`; returns `nothing` when `goalMinutes <= 0` (unchanged contract, used by `app-main.ts:332`).

- [x] **Step 1: Update the assertions in `e2e/daily.spec.ts`**

  - `const num = (page) => bar(page).locator(".num")` → `bar(page).locator("tk-bars .row .val")`.
  - "a day nobody has practised…": `toHaveText("0 / 15 min")` → `toHaveText("0 min")`, plus `await expect(bar(page).locator(".readout")).toContainText("0 of 1 at goal")`.
  - "minutes already on the device…": `toHaveText("12 / 15 min")` → `toHaveText("12 min")`; replace the `aria-valuenow` assertion with the readout containing `12 min` (hover-free: the rest readout is `0 of 1 at goal` here — assert the `.val` only).
  - "a finished day says so in words, not only in a full bar": `toHaveText("16 / 15 min · goal reached")` → `toHaveText("16 min")` on `.val` and `await expect(bar(page).locator(".readout")).toContainText("1 of 1 at goal")` — the "in words" claim is now the readout status.
  - "the goal follows the learner, not the board": `toHaveText("0 / 30 min")` → `toHaveText("0 min")`.
  - "the goal is the learner's to set": `toHaveText("12 / 30 min")` → `toHaveText("12 min")`; the goal-0 case keeps `await expect(bar(page)).toHaveCount(0)`.
- [x] **Step 2: Run e2e to verify it fails**

  Run: `npm run e2e:one -- e2e/daily.spec.ts`
  Expected: FAIL — no `tk-bars` inside `.daily`.
- [x] **Step 3: Rewrite `src/ui/daily-bar.ts`**

  ```ts
  export function dailyBar(d: DailyGoal) {
  	if (d.goalMinutes <= 0) return nothing;
  	return html`
		<div class="daily">
			<tk-bars .data=${[{ today: d.minutes }]} label="today" value="min" .goal=${d.goalMinutes} unit="min"></tk-bars>
		</div>
	`;
  }
  ```
  (Keep the file's existing comment, trimmed to what still applies: the bar answers "can I stop now?"; a finished day says so in words via the readout.)
- [x] **Step 4: Run tests to verify they pass**

  Run: `npm run e2e:one -- e2e/daily.spec.ts`
  Expected: PASS.
  Run: `npm run typecheck && npm test`
  Expected: PASS.
- [x] **Step 5: Commit**

  ```bash
  git add src/ui/daily-bar.ts e2e/daily.spec.ts
  git commit -m "feat: draw the daily goal bar with kit's tk-bars"
  ```

---

### Task 5: Cleanup and final verification

Runs after Tasks 1–4 (needs `card.ts` gone and no d3 imports left).

**Files:**
- Modify: `src/ui/app-styles.ts`
- Test: full suite via `npm run verify`

**Interfaces:**
- Consumes: nothing new.
- Produces: no dead CSS, no dead deps; `npm run verify` green.

- [x] **Step 1: Remove dead CSS from `src/ui/app-styles.ts`**

  Grep each selector before deleting (knip covers code, not CSS). Delete the rules that no longer match any markup: `.grid`, `.card b`, `.card span.label`, `.rows`, `.krow` (+ `.krow .cap`, `.krow .num`), `.kbar` (+ `.kbar.bad`), `.mark`, `.next`, `.chart` (+ all `.chart *` rules), `.legend` (+ children), `.hist .grid`, `.hist .card`, `.hist .legend`, `.daily .track`, `.daily .num`. Keep: `.card` base (insight cards still use `class="card"`), `.insights > .card *` rules, `.hist` base, `.hist h3`, `.hist .empty`, `.empty`, `.daily` (now just a width wrapper: `width: 100%; max-width: 30rem;`), `.demo-note`, `.link`, `.chips`, `.chip`.
- [x] **Step 2: Run the full verification**

  Run: `npm run verify`
  Expected: typecheck, unit tests, knip, full e2e all PASS.
- [x] **Step 3: Commit**

  ```bash
  git add src/ui/app-styles.ts
  git commit -m "chore: drop dead chart css"
  ```
