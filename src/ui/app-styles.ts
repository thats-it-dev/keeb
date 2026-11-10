import { css } from "https://kit.thatsit.app/lit.js";
import { sharedStyles } from "https://kit.thatsit.app/kit.js";

// The page stylesheet, kept out of app-main.ts so the component that composes the screen stays small.
// Everything here is kit tokens plus the layout of the page; kit components bring their own styles.
export const appStyles = [
	sharedStyles,
	css`
		main { display: grid; gap: 18px; padding: 18px; max-width: 62rem; margin: 0 auto; justify-items: center; }
		/* The insight pane is a fixed full-height column, so the document has to step aside for it. Padding
		* on the host keeps the centered main element centered in the space that is left, and it animates on
		* the same curve as the pane, so opening it reads as a resize rather than a jump. */
		:host { display: block; padding-right: 2.25rem; box-sizing: border-box; transition: padding-right 0.18s ease; }
		:host([data-panel-open]) { padding-right: 19rem; }
		.scrim { display: none; }
		@media (max-width: 899px) {
		/* A phone has no sideways room to reserve: the pane is a drawer over the content, and the page
		* keeps its full width. The scrim is what dismisses it, same as kit's shell. */
		:host, :host([data-panel-open]) { padding-right: 0; }
		.scrim { display: block; position: fixed; inset: 0; background: var(--overlay); z-index: 25; opacity: 0; pointer-events: none; transition: opacity 0.25s; }
		:host([data-panel-open]) .scrim { opacity: 1; pointer-events: auto; }
		}
		.head { display: flex; align-items: center; justify-content: space-between; gap: 14px; width: 100%; }
		.head h1 { margin: 0; }
		.head-actions { display: flex; align-items: center; gap: 6px; }
		/* Two classes, not one: the .x rule below sets display:grid with the same specificity, and whichever
		* rule comes last in the sheet wins. */
		.x.drawer-only { display: none; }
		/* And the override has to come AFTER the base rule: an @media block adds no specificity, so a media
		* declaration written earlier in the sheet loses to the one below it at every width. */
		@media (max-width: 899px) {
		.x.drawer-only { display: grid; }
		}
		.col { display: grid; gap: 14px; width: 100%; justify-items: center; }
		/* The svg inside is width:100% of its host, and an inline host has no width of its own. */
		tt-keyboard, tt-practice { display: block; width: 100%; }
		/* Settings is a modal dialog: centred by the UA, and ::backdrop is the tint over the page. */
		dialog { border: 1px solid var(--border-color); border-radius: calc(var(--radius) * 2); background: var(--bg); color: var(--text-primary); padding: 0; box-shadow: 0 18px 50px var(--shadow-color); width: min(24rem, calc(100vw - 2rem)); }
		dialog::backdrop { background: color-mix(in srgb, var(--text-primary), transparent 62%); backdrop-filter: blur(3px); }
		.modal-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--border-color); }
		/* Borderless icon button. The kit's own dialogs use a class named .x with exactly this recipe,
		* but it lives in their component styles, not in sharedStyles, so it is declared here too.
		* (.btn.ghost is NOT borderless — it keeps border-color: var(--border-color).) */
		.x { display: grid; place-items: center; width: 36px; height: 36px; flex: none; border: 0; background: none; border-radius: var(--radius); color: var(--text-muted); }
		.x:hover { color: var(--text-primary); background: var(--code-bg); }
		/* Two columns: the label sits against the left edge, the control against the right. */
		.panel { display: grid; grid-template-columns: auto 1fr; gap: 14px 16px; align-items: center; padding: 16px 14px; }
		.panel label { display: contents; }
		.panel label > .label { justify-self: start; }
		.panel label > select,
		.panel label > input { justify-self: end; width: 100%; max-width: 12rem; }
		.read { display: flex; gap: 26px; flex-wrap: wrap; justify-content: center; }
		.metric { display: grid; gap: 2px; justify-items: center; font-variant-numeric: tabular-nums; }
		.metric b { font-weight: 600; font-size: 1.05rem; }
		.row { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; justify-content: center; }
		.hit { color: var(--primary); font-weight: 600; }
		.warn { color: var(--text-muted); }
		.full { grid-column: 1 / -1; }
		.board { display: flex; align-items: center; gap: 10px; }
		.problems { margin: 0; padding-left: 1.1em; color: var(--accent); font-size: 0.85rem; }
		/* Sign-in is one line of the panel, not a section: it is optional and rarely touched. */
		.sync { display: flex; gap: 8px; align-items: center; }
		.sync input { width: 100%; max-width: 12rem; }
		/* The progress section is a pane section, so it is narrower than the page: tighter gaps, and the same
		heading type the history section above it uses. */
		.stats { width: 100%; display: grid; gap: 10px; }
		.stats h3 { margin: 0; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
		.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 14px; }
		.card { display: grid; gap: 4px; padding: 12px 14px; border: 1px solid var(--border-color); border-radius: var(--radius); background: var(--code-bg); }
		.card b { font-size: 1.4rem; font-weight: 600; font-variant-numeric: tabular-nums; }
		.card span.label { font-size: 0.75rem; }
		.rows { display: grid; gap: 5px; }
		.krow { display: grid; grid-template-columns: 2.2rem 1fr 5.5rem; gap: 10px; align-items: center; font-variant-numeric: tabular-nums; }
		.krow .cap { font-weight: 600; }
		.krow .num { text-align: right; color: var(--text-muted); font-size: 0.8rem; }
		.track { position: relative; height: 8px; border-radius: 4px; background: var(--code-bg); overflow: hidden; }
		.kbar { position: absolute; inset: 0 auto 0 0; border-radius: 4px; background: var(--primary); }
		.kbar.bad { background: var(--accent); }
		/* The goal line: without it a half-full bar cannot be read as slow or as on target. */
		.mark { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--text-muted); }
		.next { outline: 2px solid var(--primary); outline-offset: 3px; border-radius: var(--radius); }
		.empty { margin: 0; color: var(--text-muted); }
		/* Keys with no data get a chip, not a row: 40 empty bars would bury the 20 that mean something. */
		.chips { display: inline-flex; gap: 4px; flex-wrap: wrap; }
		.chip { display: inline grid; place-items: center; min-width: 1.5rem; padding: 1px 5px; border: 1px solid var(--border-color); border-radius: calc(var(--radius) / 2); font-size: 0.75rem; opacity: 0.75; }
		/* History: a line per day, broken at the days you skipped -- an unbroken slope through a rest day
		* would claim a decline that never happened. */
		/* The insight pane is an editor's sidebar, not a drawer: it is pinned to the height of the history
		* section and scrolls its own cards, and it collapses sideways. Flex or grid cannot give a spanning
		* item a height derived from its SIBLING -- the panel's own prose would grow the row instead -- so the
		* pane is absolutely positioned and the text column reserves the width it needs. Both animate on the
		* same transition, so the chart appears to stretch rather than jump. */
		/* The history section is a plain stack: the insight pane belongs to the shell, not to this screen, so
		* no room is reserved inside it. */
		.hist { display: grid; gap: 10px; width: 100%; }
		/* The section lives in a 19rem column, so the totals wrap tighter and carry less type than a
		full-width screen would want. */
		.hist .grid { grid-template-columns: repeat(auto-fit, minmax(7.25rem, 1fr)); gap: 8px; }
		.hist .card { padding: 7px 9px; }
		.hist .card b { font-size: 1.05rem; }
		.hist .legend, .hist .empty { font-size: 0.72rem; }
		/* Fill the column instead of letterboxing: viewBox is 340x118, and a fixed 8rem height in a 280px
		wide pane would waste the bottom of every box. */
		.hist .chart { height: auto; aspect-ratio: 340 / 118; }
		.hist h3 { margin: 0; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
		.chart { width: 100%; height: 8rem; display: block; overflow: visible; }
		.chart text { font-size: 8px; fill: var(--text-muted); font-variant-numeric: tabular-nums; }
		.chart .grid line { stroke: var(--border-color); stroke-width: 0.5; }
		.chart .axis { stroke: var(--text-muted); stroke-width: 0.75; opacity: 0.45; }
		.chart .goal { stroke: var(--text-muted); stroke-width: 0.75; stroke-dasharray: 3 2; }
		.chart circle.ok { fill: var(--primary); }
		.chart circle.under { fill: var(--accent); }
		.chart .gap { fill: var(--accent); opacity: 0.13; stroke: none; }
		.chart .typing { fill: none; stroke: var(--text-muted); stroke-width: 1.2; stroke-dasharray: 4 2.5; stroke-linejoin: round; opacity: 0.85; }
		.chart .trend { fill: none; stroke: var(--primary); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; opacity: 0.9; }
		.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; margin: 0; font-size: 0.75rem; color: var(--text-muted); grid-column: 1; }
		.legend .key { display: inline-block; width: 16px; border-top: 2px solid; margin-right: 5px; vertical-align: middle; }
		.legend .key.clock { border-top-color: var(--primary); }
		.legend .key.typing { border-top-style: dashed; border-top-color: var(--text-muted); }
		.legend .gapkey { display: inline-block; width: 16px; height: 8px; background: var(--accent); opacity: 0.13; margin-right: 5px; }
		/* Demo data announces itself. A chart that looks like progress and is not progress is the one
		* failure mode this screen has been built to avoid. */
		.demo-note { margin: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; padding: 8px 10px; border: 1px dashed var(--accent); border-radius: var(--radius); color: var(--text-muted); font-size: 0.85rem; }
		.demo-note b { color: var(--accent); letter-spacing: 0.04em; text-transform: uppercase; font-size: 0.75rem; }
		.link { border: 0; background: none; color: var(--primary); font: inherit; padding: 0; cursor: pointer; text-decoration: underline; }
	`,
];
