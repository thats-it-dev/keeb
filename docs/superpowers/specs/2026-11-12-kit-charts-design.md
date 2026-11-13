# Keeb: replace hand-drawn charts with kit chart components

Date: 2026-11-12 · Status: approved (2026-11-12, option 1 chosen for the daily bar)

## Intent

Keeb's insight panel and practice screen draw their own charts (d3 SVG, hand-rolled bar
rows, CSS stat tiles). The kit now ships the same four chart types as shared, tested,
accessible components. Swap the hand-drawn ones for the kit's so keeb stops maintaining
geometry it does not own and gets the kit's readout/keyboard/table a11y for free.

## Goals

1. History chart drawn by `tk-timeseries` (two series + pausing band + goal line).
2. Per-key bars drawn by `tk-bars` (ms, `lower`, goal tick).
3. Stat cards drawn by `tk-stats`/`tk-stat` in both the progress and history sections.
4. Daily goal bar drawn by `tk-bars` (single row, today's minutes vs goal).
5. d3 dependencies removed; dead CSS and `src/ui/card.ts` deleted; e2e + unit tests
   rewritten against the new markup.

## Non-goals

- No kit changes: only components already published at kit.thatsit.app are used.
- No data-model changes: `history.ts`, `overview.ts` (minus `barWidth`), `daily.ts` keep
  computing the same numbers.
- No new per-row metadata in the key bars (per-key error counts and the "next key"
  outline are dropped from the bar rows; the focus letter stays visible via the
  keyboard ring and the focus paragraph).

## Constraints

- Kit is consumed as the published `https://kit.thatsit.app/kit.js` (types cached in
  `.kit/`); nothing from the kit repo directly.
- Guardrail: `src/*.ts` stays ≤ 400 lines (`test/guardrails.test.ts`).
- The history chart must keep its honesty properties: skipped days consume a slot,
  a day with no per-key stats draws the clock line only (no band), the demo/preview
  prompt stays outside the chart.

## Approaches

- **Swap to kit components (chosen).** 1:1 mapping exists; the kit demo
  (`kit/demo/charts.html`) already mocks this exact layout. d3 becomes removable.
- **Keep hand-drawn, restyle with kit tokens.** Saves the test rewrites but keeps two
  implementations of the same four charts — the exact thing the kit was built to end.
- **New `tk-progress` in kit for the daily bar (rejected for now).** Cleaner, but a
  kit-repo change plus publish for one bar; a single `tk-bars` row covers it
  (fill meets the tick exactly at goal, "at goal" status text for free). Revisit if a
  second app wants a progress bar.

## Decisions

- Daily bar = one-row `tk-bars`: `label="today"`, value = minutes, `goal=goalMinutes`,
  `unit="min"`. `goalMinutes <= 0` renders nothing (as today).
- Per-key bars = `tk-bars value="ms" lower goal=goalMs unit="ms"` over
  `o.measured` rows. The scale changes from keeb's log2 to kit's reciprocal
  (goal tick at 80%); ranking and the at-goal/below-goal status are preserved.
- History = `tk-timeseries` with `series=[{y:"wpm",label:"with pauses"},
  {y:"strokeWpm",label:"typing only",defined: r=>r.strokeWpm>0}]`,
  `band="wpm strokeWpm"`, `band-label="pausing"`, `goal`, `unit="wpm"`, data =
  `series(h, 40)`.
- Stat cards: `tk-stats` of `tk-stat` tiles. Progress: average, at goal, errors, keys,
  hands. History: sessions, characters, practised, streak, best day.
- The empty-history prompt (preview host, "Show demo sessions") stays in
  `history-section.ts` above the chart; the chart's own empty line is the kit default.

## Left to the builder

- Rewrite `e2e/history.spec.ts`, `e2e/practice.spec.ts` (bar width assertions become
  tk-bars assertions) and `test/overview.test.ts` (drop `barWidth`).
- Remove `d3-array`, `d3-scale`, `d3-shape` + `@types/d3-*` from package.json and the
  now-dead CSS in `src/ui/app-styles.ts` (`.chart *`, `.krow`, `.kbar`, `.mark`,
  `.card`, `.legend`, `.daily .track`, …).
- Keep `overview.ts`'s `barWidth`/`GOAL_AT` deleted: nothing may import them.
