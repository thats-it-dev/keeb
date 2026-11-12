import { css } from "https://kit.thatsit.app/lit.js";
import { sharedStyles } from "https://kit.thatsit.app/kit.js";

// The page stylesheet, kept out of app-main.ts so the component that composes the screen stays small.
// Everything here is kit tokens plus the layout of the page; kit components bring their own styles.
export const appStyles = [
	sharedStyles,
	css`
		main { display: grid; gap: 18px; padding: 18px; max-width: 62rem; margin: 0 auto; justify-items: center; }
		/* The kit shell owns the layout: its main column fills the window, this one element inside it scrolls,
		* and tk-header sticks to its top. The insights live in the shell's aside panel, not in this file's layout. */
		:host { display: block; height: 100%; }
		.page { overflow-y: auto; height: 100%; }
		/* The aside panel's own scroll column: the sections stacked into it, in reading order, each edged off
		* the next. It belongs to the shell, which sizes and folds it. */
		.insights { display: grid; align-content: start; height: 100%; overflow-y: auto; background: var(--bg); }
		.insights > * { padding: 14px 12px; border-bottom: 1px solid var(--line); }
		/* The insight cards sit flat in that column, unlike the .card tiles the history totals use. */
		.insights > .card { display: block; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: none; }
		.insights > .card h3 { margin: 0 0 6px; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
		.insights > .card .big { margin: 0; font-size: 1.4rem; font-weight: 700; }
		.insights > .card .big .sub { display: block; font-size: 0.75rem; font-weight: 400; color: var(--text-muted); }
		.insights > .card .say { margin: 6px 0 0; font-size: 0.85rem; line-height: 1.45; }
		.insights > .card .row { display: flex; justify-content: space-between; gap: 10px; margin: 4px 0 0; font-size: 0.85rem; }
		.insights > .card .row b { font-size: 0.85rem; }
		.insights > .card .row span { color: var(--text-muted); text-align: right; }
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
		/* Today's minutes under the numbers: the track takes the middle, the words hold both ends. */
		.daily { display: flex; gap: 10px; align-items: center; width: 100%; max-width: 30rem; }
		.hit { color: var(--primary); font-weight: 600; }
		.warn { color: var(--text-muted); }
		.full { grid-column: 1 / -1; }
		.board { display: flex; align-items: center; gap: 10px; }
		.problems { margin: 0; padding-left: 1.1em; color: var(--accent); font-size: 0.85rem; }
		/* Sign-in is one line of the panel, not a section: it is optional and rarely touched. */
		/* The progress section is a pane section, so it is narrower than the page: tighter gaps, and the same
		heading type the history section above it uses. */
		.stats { width: 100%; display: grid; gap: 10px; }
		.stats h3 { margin: 0; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
		.card { display: grid; gap: 4px; padding: 12px 14px; border: 1px solid var(--border-color); border-radius: var(--radius); background: var(--code-bg); }
		.empty { margin: 0; color: var(--text-muted); }
		/* Keys with no data get a chip, not a row: 40 empty bars would bury the 20 that mean something. */
		.chips { display: inline-flex; gap: 4px; flex-wrap: wrap; }
		.chip { display: inline grid; place-items: center; min-width: 1.5rem; padding: 1px 5px; border: 1px solid var(--border-color); border-radius: calc(var(--radius) / 2); font-size: 0.75rem; opacity: 0.75; }
		/* History: a line per day, broken at the days you skipped -- an unbroken slope through a rest day
		* would claim a decline that never happened. */
		.hist { display: grid; gap: 10px; width: 100%; }
		.hist .empty { font-size: 0.72rem; }
		.hist h3 { margin: 0; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
		/* Demo data announces itself. A chart that looks like progress and is not progress is the one
		* failure mode this screen has been built to avoid. */
		.demo-note { margin: 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; padding: 8px 10px; border: 1px dashed var(--accent); border-radius: var(--radius); color: var(--text-muted); font-size: 0.85rem; }
		.demo-note b { color: var(--accent); letter-spacing: 0.04em; text-transform: uppercase; font-size: 0.75rem; }
		.link { border: 0; background: none; color: var(--primary); font: inherit; padding: 0; cursor: pointer; text-decoration: underline; }
	`,
];
