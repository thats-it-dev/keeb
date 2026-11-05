import { LitElement, html, svg, css, nothing } from "https://kit.thatsit.app/lit.js";
import { sharedStyles } from "https://kit.thatsit.app/kit.js";
import { GEOMETRIES, allGeometries, forgetGeometry, geometryById, registerGeometry } from "./data/geometries.ts";
import { KEYMAPS, allKeymaps, forgetKeymap, keymapById, registerKeymap } from "./data/keymaps.ts";
import { deleteBoard, deleteMap, layoutKey, loadBoards, loadHistory, loadMaps, loadSettings, loadStats, loadSyncState, saveBoard, saveHistory, saveMap, saveSettings, saveStats, saveSyncState, DEFAULT_SETTINGS, type Settings } from "./data/store.ts";
import { auth } from "./atproto/auth.ts";
import { Sync, type SyncState } from "./atproto/sync.ts";
import { mergeProgress, type SessionRow } from "./atproto/records.ts";
import { cpmToWpm, wpmToCpm, type StatMap } from "./stats/stats.ts";
import { barWidth, GOAL_AT, overview, type KeyInfo } from "./stats/overview.ts";
import { history as buildHistory, series, type Point } from "./stats/history.ts";
import { demoSessions, isPreviewHost } from "./stats/demo.ts";
import { insightPanel, type PanelCard } from "./stats/panel.ts";
import { PANEL_OPEN_KEY } from "./stats/panel-element.ts";
import { scaleBand, scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import { max } from "d3-array";
import { resolve, type Resolved } from "./keyboard/resolve.ts";
import { FINGER_NAME, type Geometry, type Keymap } from "./keyboard/types.ts";
import { geometryFromLayout, importId, importName } from "./layout/parse.ts";
import { isKeycapFile, keymapFromKeycap, type KeycapFile } from "./layout/keycap.ts";
import { iconPanelRight, iconSettings, iconTrash, iconX } from "./ui/icons.ts";
import "./keyboard/view.ts";
import "./lesson/practice.ts";
import type { TtPractice } from "./lesson/practice.ts";

// Which board and which keymap, per browser. Progress itself lives in IndexedDB.
const STORE = "keeb:layout";

function saved(): { g: string; k: string } {
	try {
		const v = JSON.parse(localStorage.getItem(STORE) ?? "") as { g?: string; k?: string };
		if (typeof v.g === "string" && typeof v.k === "string" && allGeometries().some((g) => g.id === v.g) && allKeymaps().some((k) => k.id === v.k)) {
			return { g: v.g, k: v.k };
		}
	} catch {
		/* first run or junk in the slot */
	}
	return { g: GEOMETRIES[0].id, k: KEYMAPS[0].id };
}

// What a key should be called on screen. A space has to be spelled out -- it is the most-struck key on
// the board, and an invisible row label reads as a bug in the screen rather than as the space bar. A key
// with no character at all (an unmapped pinky column) falls back to its id, which is at least something
// to point at.
function keyLabel(k: { id: string; char: string }): string {
	if (k.char === " ") return "space";
	return k.char.trim() === "" ? k.id : k.char;
}

// The history chart's geometry, in SVG units: room on the left for speed labels, below for dates.
const CH = { w: 340, h: 118, pad: { l: 26, r: 8, t: 10, b: 24 } };

/** "YYYY-MM-DD" back to a local date at noon, so no timezone edge can move it into yesterday. */
function parseDay(day: string): Date {
	const [y, m, d] = day.split("-").map(Number);
	return new Date(y!, (m ?? 1) - 1, d ?? 1, 12);
}

// The one card template, so the key stats and the history cannot render the same kind of number two ways.
function card(label: string, value: string) {
	return html`<div class="card"><span class="label">${label}</span><b>${value}</b></div>`;
}

// Summing per-key samples gives the session totals without double-counting a repeated key.
function totals(stats: StatMap): { chars: number; errors: number } {	let chars = 0;
	let errors = 0;
	for (const s of Object.values(stats)) {
		chars += s.samples;
		errors += s.errors;
	}
	return { chars, errors };
}

// SyncState lives in IndexedDB with everything else that has to survive a reload.
const syncStore = {
	load: () => loadSyncState(),
	// The store keeps one row; the spread is what makes it that row rather than a second one.
	save: async (s: SyncState) => saveSyncState(s),
};

export class AppMain extends LitElement {
	static properties = { geometryId: { state: true }, keymapId: { state: true }, ready: { state: true }, lastId: { state: true }, nowCpm: { state: true }, targetCpm: { state: true }, settingsOpen: { state: true }, view: { state: true }, sessions: { state: true }, demo: { state: true }, boards: { state: true }, maps: { state: true }, importProblems: { state: true }, did: { state: true }, syncNote: { state: true }, panelOpen: { type: Boolean, attribute: "data-panel-open", reflect: true } };
	static styles = [
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
			 * rule comes last in the sheet wins. That is how a phone-only button ended up in the desktop header. */
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
			/* Stats screen: one line per key, so the eye lands on the shortest bars first. */
			.stats { width: 100%; display: grid; gap: 16px; }
			.stats h2 { margin: 0; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
			.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 14px; }
			.card { display: grid; gap: 4px; padding: 12px 14px; border: 1px solid var(--border-color); border-radius: var(--radius); background: var(--code-bg); }
			.card b { font-size: 1.4rem; font-weight: 600; font-variant-numeric: tabular-nums; }
			.card span.label { font-size: 0.75rem; }
			.rows { display: grid; gap: 5px; }
			.krow { display: grid; grid-template-columns: 2.2rem 1fr 5.5rem; gap: 10px; align-items: center; font-variant-numeric: tabular-nums; }
			.krow .cap { font-weight: 600; }
			.krow .num { text-align: right; color: var(--text-muted); font-size: 0.8rem; }
			.track { position: relative; height: 8px; border-radius: 4px; background: var(--code-bg); overflow: hidden; }
			.bar { position: absolute; inset: 0 auto 0 0; border-radius: 4px; background: var(--primary); }
			.bar.bad { background: var(--accent); }
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
			/* The history section is a plain stack now: the insight pane belongs to the shell, not to this
			 * screen, so it no longer reserves room inside it. */
			.hist { display: grid; gap: 10px; width: 100%; }
			/* The section now lives in a 19rem column, not across the page, so the totals wrap tighter and carry
			   less type than they did on the progress screen. */
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

	geometryId = saved().g;
	settingsOpen = false;
	// Which pane is showing. Typing stays the default: a returning learner came to type, and the button is
	// how the stats screen remains one click away instead of hiding behind a modal. Deliberately not
	// persisted — losing it on reload costs nothing, and a stored flag is one more thing to get stale.
	view: "type" | "progress" = "type";
	// Practice sessions as the PDS keeps them, cached in IndexedDB. Empty until something has synced.
	sessions: SessionRow[] = [];
	// Which way the insight pane is folded. Read here and passed down, because the page has to reserve the same
	// width the pane takes -- a child that kept this to itself would overlap the content.
	// Three rules, in order of who wins:
	//   - on a phone the pane is an off-canvas MENU, and a menu that redeploys itself over the page on every
	//     load is a bug users would report. The stored choice is ignored there; it always starts closed.
	//   - a branch preview defaults to OPEN, because the history section lives in the pane and on a preview that
	//     section carries the only "show demo sessions" prompt: a folded pane would leave a reviewer at a blank rail.
	//   - anywhere else, whatever the person last chose is what they get.
	panelOpen = matchMedia("(min-width: 900px)").matches && (localStorage.getItem(PANEL_OPEN_KEY) === null ? isPreviewHost(location.hostname, __APP_NAME__) : localStorage.getItem(PANEL_OPEN_KEY) === "1");
	// Fake history for previews, switched on by ?demo=1. Generated per render and never stored anywhere:
	// a preview visit must not be able to write a made-up session into a real repo or a real device.
	demo = new URLSearchParams(location.search).has("demo");
	keymapId = saved().k;
	// Layout files the learner imported, straight out of IndexedDB.
	boards: Geometry[] = [];
	maps: Keymap[] = [];
	importProblems: string[] = [];
	// Signed-in account, and the one line the sync layer is allowed to say out loud.
	did = "";
	syncNote = "";
	#sync: Sync | undefined;
	#handle = "";
	// What the counters read when the current session started, so a session record holds a delta.
	#baseline = { chars: 0, errors: 0 };
	#startedAt = 0;
	#idleTimer: number | undefined;
	// False until IndexedDB has answered; the lesson needs past stats to choose its keys.
	ready = false;
	lastId = "";
	// Speed of the last keystroke. The practice pane knows it first, but the numbers above the line have
	// to render from parent state: reading them off the child element means asking the DOM for a node that
	// this very render pass is what creates, and after a reload the row would sit on "loading" forever.
	nowCpm = 0;
	targetCpm = DEFAULT_SETTINGS.targetCpm;
	stats: StatMap = {};
	settings: Settings = DEFAULT_SETTINGS;
	#cache: { g: string; k: string; r: Resolved } | undefined;
	#bound = false;
	// Identifies the newest layout load, so an old IndexedDB answer cannot overwrite a newer choice.
	#pending: symbol | undefined;

	override firstUpdated(): void {
		// Stored boards and keymaps have to be registered before the saved selection is read, and the ids
		// re-assigned afterwards: the field initializers called saved() against an empty registry, so they
		// hold the shipped defaults even when the stored choice says otherwise.
		void Promise.all([loadBoards(), loadMaps()]).then(([boards, maps]) => {
			this.boards = boards;
			this.maps = maps;
			for (const b of boards) registerGeometry(b);
			for (const m of maps) registerKeymap(m);
			const sel = saved();
			const moved = sel.g !== this.geometryId || sel.k !== this.keymapId;
			this.geometryId = sel.g;
			this.keymapId = sel.k;
			// updated() reloads when an id changed; when nothing moved this is the only place that loads.
			if (!moved) void this.#load(sel);
			void this.#bootSync();
			// Closing the tab ends a practice session; the browser gets one last look at it.
			window.addEventListener("pagehide", () => void this.#endSession());
		});
		// Kept out of the call above on purpose. The lesson cannot start until that one resolves, and cached
		// sessions are an add-on: a history store that rejects or stalls must never be why nobody can type.
		void loadHistory()
			.then((sessions) => {
				this.sessions = sessions;
			})
			.catch(() => undefined);
	}

	// Restore a session if this browser has one, and finish a sign-in redirect if one is in flight.
	async #bootSync(): Promise<void> {
		try {
			const s = await auth.session();
			if (!s) return;
			this.did = s.did;
			this.#sync = new Sync(s, syncStore);
			await this.#syncNow(false);
		} catch (err) {
			this.syncNote = (err as Error).message;
		}
	}

	override disconnectedCallback(): void {
		if (this.#bound) {
			window.removeEventListener("keydown", this.#onKey);
			window.removeEventListener("keydown", this.#onEsc);
		}
		this.#bound = false;
		super.disconnectedCallback();
	}

	override updated(changed: Map<string, unknown>): void {
		if (changed.has("geometryId") || changed.has("keymapId")) void this.#load({ g: this.geometryId, k: this.keymapId });
		if (changed.has("settingsOpen")) this.#syncDialog();
		if (this.ready && !this.#bound) {
			window.addEventListener("keydown", this.#onKey);
			window.addEventListener("keydown", this.#onEsc);
			this.#bound = true;
		}
	}

	// showModal() and close() are imperative, so the reactive flag drives them once per update.
	#syncDialog(): void {
		const dlg = this.renderRoot.querySelector("dialog") as HTMLDialogElement | null;
		if (!dlg || dlg.open === this.settingsOpen) return;
		if (this.settingsOpen) dlg.showModal();
		else dlg.close();
	}

	async #load(sel: { g: string; k: string }): Promise<void> {
		this.#cache = undefined;
		const key = layoutKey(sel.g, sel.k);
		const token = Symbol("load");
		this.#pending = token;
		this.ready = false;
		const [stored, settings] = await Promise.all([loadStats(key), loadSettings(key)]);
		if (this.#pending !== token) return; // a newer selection won the race
		this.settings = { ...DEFAULT_SETTINGS, ...settings, geometry: sel.g, keymap: sel.k };
		localStorage.setItem(STORE, JSON.stringify(sel));
		this.stats = stored;
		this.targetCpm = this.settings.targetCpm;
		this.#saved = JSON.stringify(stored);
		// The switch is safe because ready was false for the whole await, which unmounts <tt-practice>:
		// #type cannot run, so no keystroke can write another layout's stats under this key. The next render
		// hands the child the new .resolved, and practice.ts restarts its engine from scratch on that.
		// If you ever keep the pane mounted across a load, that guarantee goes away and this needs a restart.
		this.ready = true;
	}

	get #resolved(): Resolved {
		if (!this.#cache || this.#cache.g !== this.geometryId || this.#cache.k !== this.keymapId) {
			this.#cache = { g: this.geometryId, k: this.keymapId, r: resolve(geometryById(this.geometryId), keymapById(this.keymapId)) };
		}
		return this.#cache.r;
	}

	get #practice(): TtPractice | undefined {
		return (this.renderRoot.querySelector("tt-practice") as TtPractice | null) ?? undefined;
	}

	#onKey = (e: KeyboardEvent): void => {
		if (this.settingsOpen) return; // the modal owns the keyboard while it is up
		const t = e.target as HTMLElement | null;
		if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
		// A held key is one intention, not twenty: the OS sends repeat:true keydowns at ~30/sec, and each one
		// that passed through here charged an error to the target key and turned the letter the learner has
		// not typed yet red. That reads as the line running ahead of the fingers.
		if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
		e.preventDefault();
		void this.#type(e.key);
	};

	async #type(ch: string): Promise<void> {
		const p = this.#practice;
		if (!p) return;
		if (!this.#startedAt) this.#startSession();
		this.#armIdle();
		this.lastId = p.key(ch, performance.now()) ?? "";
		this.nowCpm = p.instantCpm;
		// Read the engine AFTER the keystroke. p.key() replaces it with a new object; holding the reference
		// from before the call would persist the stats as they stood one key ago — and on the very first
		// keystroke that is undefined, so nothing is saved at all.
		if (p.engine) await this.#flushStats(p.engine);
	}

	// A session is the span between two silences, which is what the record is named for: it ends when the
	// learner walks away, and what they left behind becomes one row on their repo.
	#startSession(): void {
		this.#startedAt = Date.now();
		this.#baseline = totals(this.stats);
	}

	#armIdle(): void {
		if (this.#idleTimer !== undefined) window.clearTimeout(this.#idleTimer);
		this.#idleTimer = window.setTimeout(() => void this.#endSession(), 120_000);
	}

	async #endSession(): Promise<void> {
		if (!this.#startedAt) return;
		if (this.#idleTimer !== undefined) window.clearTimeout(this.#idleTimer);
		this.#idleTimer = undefined;
		const now = totals(this.stats);
		const chars = now.chars - this.#baseline.chars;
		const errors = now.errors - this.#baseline.errors;
		const ms = Date.now() - this.#startedAt;
		this.#startedAt = 0;
		if (chars <= 0 || !this.#sync) return; // offline-first: the practice data is already in IndexedDB
		const res = await this.#sync.pushSession(layoutKey(this.geometryId, this.keymapId), { chars, errors, ms, stats: this.stats }, Date.now());
		this.syncNote = res.error ?? (res.sent ? `synced ${chars} characters` : "");
	}

	async #flush(p: TtPractice): Promise<void> {
		if (p.engine) await this.#flushStats(p.engine);
	}

	async #flushStats(engine: NonNullable<TtPractice["engine"]>): Promise<void> {
		// Captured once, at the top. The writes below are awaited, and a board switch can land between them:
		// reading this.geometryId again would describe the row as the NEW layout while storing it under the
		// OLD layout's key, and a reader that keys off the fields instead of the row id would disagree with
		// one that keys off the id. One snapshot, and both agree.
		const { geometryId: g, keymapId: k } = this;
		const key = layoutKey(g, k);
		this.stats = { ...engine.stats };
		const previous = this.#saved;
		const now = JSON.stringify(engine.stats);
		if (previous === now) return; // nothing moved: wrong key, or the line is already finished
		this.#saved = now;
		await saveStats(key, this.stats);
		await saveSettings(key, { ...this.settings, geometry: g, keymap: k, targetCpm: this.targetCpm, unlocked: engine.ladder.unlocked });
	}

	#saved = "";

	#pick(part: "g" | "k", value: string): void {
		// Close the session while the old layout is still selected. #load replaces this.stats with the new
		// layout's map, and #endSession computes a delta against the baseline it took from the OLD one — that
		// difference is usually negative, and a negative delta is discarded, so switching mid-session would
		// silently lose the characters you had just typed.
		if (part === "g" ? value !== this.geometryId : value !== this.keymapId) void this.#endSession();
		if (part === "g") this.geometryId = value;
		else this.keymapId = value;
	}

	// The field is words per minute; the stored goal stays characters per minute, so the number that goes
	// to the PDS and drives the ladder does not depend on a word ever being five letters.
	#goal(e: Event): void {
		const v = Number((e.target as HTMLInputElement).value);
		if (Number.isFinite(v) && v >= 15 && v <= 120) this.targetCpm = wpmToCpm(v);
	}

	// Bring the account and this browser into line, in whichever direction each piece is newer.
	async #syncNow(adapt = true): Promise<void> {
		if (!this.#sync) return;
		this.syncNote = "";
		const key = layoutKey(this.geometryId, this.keymapId);
		const { settings, progress, sessions } = await this.#sync.pull();
		// Cached only once the network has actually answered. saveHistory replaces the cache wholesale, so
		// calling it on a failed pull would erase the history the offline chart is drawing.
		await saveHistory(sessions);
		this.sessions = sessions;
		const remote = progress[key];
		if (remote) {
			const merged = mergeProgress(this.stats, remote);
			await saveStats(key, merged);
			this.stats = merged;
			// The engine holds its own copy; rebuilding the lesson is what makes the merged speed count.
			void this.#load({ g: this.geometryId, k: this.keymapId });
		}
		// Adopting a board mid-typing would yank it out from under the learner, so settings only cross
		// over on a quiet page: at boot, or when they press Sync.
		if (adapt && (settings.geometry || settings.keymap || settings.targetCpm)) {
			const g = settings.geometry && allGeometries().some((x) => x.id === settings.geometry) ? settings.geometry : this.geometryId;
			const k = settings.keymap && allKeymaps().some((x) => x.id === settings.keymap) ? settings.keymap : this.keymapId;
			if (settings.targetCpm) this.targetCpm = settings.targetCpm;
			if (g !== this.geometryId || k !== this.keymapId) {
				this.geometryId = g;
				this.keymapId = k;
			} else void this.#load({ g, k });
		}
		await this.#sync.pushSettings({ geometry: this.geometryId, keymap: this.keymapId, targetCpm: this.targetCpm, unlocked: [] }, Date.now());
		const queued = await this.#sync.flush(Date.now());
		this.syncNote = queued.error ?? (queued.sent ? `${queued.sent} session(s) sent` : "up to date");
	}

	async #signIn(): Promise<void> {
		this.syncNote = "";
		try {
			// One call, one authorisation request: asking twice would replace the PKCE state in storage and
			// the callback would no longer match the URL the browser was sent to.
			const url = await auth.authorizeUrl(this.#handle);
			location.assign(url);
		} catch (err) {
			this.syncNote = (err as Error).message;
		}
	}

	async #signOut(): Promise<void> {
		await this.#endSession();
		await auth.signOut();
		this.did = "";
		this.#sync = undefined;
		this.syncNote = "signed out; progress stays on this device";
	}

	// Read a layout file the learner picked. Two shapes arrive here: a keyboard-layout-editor
	// info.json, which describes a board's positions, and a MoErgo Layout Editor export, which names a
	// board and gives the characters. The same control takes either.
	async #upload(e: Event): Promise<void> {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const id = importId(file.name);
		try {
			const json: unknown = JSON.parse(await file.text());
			if (isKeycapFile(json)) return void (await this.#importKeycap(json, file.name, id));
			const { geometry, problems } = geometryFromLayout(json, { id, name: importName(file.name), source: file.name });
			this.importProblems = problems;
			if (!geometry) return;
			// Re-importing the same file replaces the earlier copy rather than piling up near-duplicates.
			forgetGeometry(id);
			registerGeometry(geometry);
			await saveBoard(geometry);
			this.boards = [...this.boards.filter((b) => b.id !== id), geometry];
			this.geometryId = id;
		} catch (err) {
			this.importProblems = [`${file.name}: ${(err as Error).message}`];
		}
	}

	// A layout editor export carries characters, not positions: the board it names has to be one we know.
	// When it names something we don't have, it is checked against the board already on screen, and the
	// resulting problem says so in terms of both.
	async #importKeycap(file: KeycapFile, fileName: string, id: string): Promise<void> {
		const named = String(file.keyboard ?? "").toLowerCase();
		const base = allGeometries().find((g) => g.id === named) ?? geometryById(this.geometryId);
		const { keymap, problems } = keymapFromKeycap(file, base, id, importName(fileName));
		this.importProblems = problems;
		if (!keymap) return;
		forgetKeymap(id);
		registerKeymap(keymap);
		await saveMap(keymap);
		this.maps = [...this.maps.filter((m) => m.id !== id), keymap];
		this.keymapId = id;
	}

	async #removeMap(id: string): Promise<void> {
		forgetKeymap(id);
		await deleteMap(id);
		this.maps = this.maps.filter((m) => m.id !== id);
		if (this.keymapId === id) this.keymapId = KEYMAPS[0].id;
	}

	async #removeBoard(id: string): Promise<void> {
		forgetGeometry(id);
		await deleteBoard(id);
		this.boards = this.boards.filter((b) => b.id !== id);
		if (this.geometryId === id) this.geometryId = GEOMETRIES[0].id;
	}

	#next(): void {
		const p = this.#practice;
		if (!p) return;
		void this.#flush(p);
		p.begin();
	}

	override render() {
		const r = this.#resolved;
		const geo = geometryById(this.geometryId);
		return html`
			<main>
				<div class="head">
					<h1>${__APP_HEADING__}</h1>
					<div class="head-actions">
						<!-- On a phone the pane is off-canvas, so the rail that opens it on a desktop is gone. This is
							the only way in, and it hides itself above the drawer breakpoint where the rail returns. -->
						<button class="x drawer-only" aria-label="Insights" .ariaExpanded=${this.panelOpen ? "true" : "false"} @click=${() => this.#panel(!this.panelOpen)}>${iconPanelRight}</button>
						<button class="x" aria-label="Settings" aria-haspopup="dialog" .ariaExpanded=${this.settingsOpen ? "true" : "false"} @click=${() => (this.settingsOpen = true)}>${iconSettings}</button>
					</div>
				</div>
				<dialog @close=${() => (this.settingsOpen = false)} @click=${this.#onDialogClick} aria-label="Settings">
					<div class="modal-head">
						<span class="label">settings</span>
						<button class="x" aria-label="Close settings" @click=${() => (this.settingsOpen = false)}>${iconX}</button>
					</div>
					<div class="panel">
						<label><span class="label">keyboard</span><select @change=${(e: Event) => this.#pick("g", (e.target as HTMLSelectElement).value)}>
								${allGeometries().map((g) => html`<option value=${g.id} ?selected=${g.id === this.geometryId}>${g.name}</option>`)}
							</select></label>
						<label><span class="label">keymap</span><select @change=${(e: Event) => this.#pick("k", (e.target as HTMLSelectElement).value)}>
								${allKeymaps().map((k) => html`<option value=${k.id} ?selected=${k.id === this.keymapId}>${k.name}</option>`)}
							</select></label>
						<label><span class="label">goal wpm</span><input type="number" min="15" max="120" step="5" .value=${String(cpmToWpm(this.targetCpm))} @change=${this.#goal} /></label>
						<label><span class="label">layout file</span><input type="file" accept=".json,application/json" @change=${this.#upload} /></label>
						<div class="full sync">
							${this.did
								? html`<span class="label">${this.did}</span>
										<button class="btn ghost" @click=${() => void this.#syncNow()}>Sync now</button>
										<button class="x" aria-label="Sign out" @click=${() => void this.#signOut()}>${iconX}</button>`
								: html`<input
										aria-label="atproto handle"
										placeholder="you.bsky.social"
										.value=${this.#handle}
										@input=${(e: Event) => (this.#handle = (e.target as HTMLInputElement).value)}
									/>
									<button class="btn" @click=${() => void this.#signIn()}>Sign in</button>`}
						</div>
						${this.syncNote ? html`<p class="full warn">${this.syncNote}</p>` : nothing}
						${this.boards.length
							? html`<div class="full">${this.boards.map((b) => html`<div class="board"><span>${b.name}</span> <span class="label">${b.keys.length} keys</span> <button class="x" aria-label=${`Remove ${b.name}`} @click=${() => this.#removeBoard(b.id)}>${iconTrash}</button></div>`)}</div>`
							: nothing}
						${this.maps.length
							? html`<div class="full">${this.maps.map((m) => html`<div class="board"><span>${m.name}</span> <span class="label">characters</span> <button class="x" aria-label=${`Remove ${m.name}`} @click=${() => this.#removeMap(m.id)}>${iconTrash}</button></div>`)}</div>`
							: nothing}
						${this.importProblems.length ? html`<ul class="full problems">${this.importProblems.map((p) => html`<li>${p}</li>`)}</ul>` : nothing}
					</div>
				</dialog>
				<div class="col">
					${this.ready ? this.#readout() : html`<div class="read"><span class="label">loading your progress…</span></div>`}
					${this.ready
						? html`<tt-practice .resolved=${r} .stats=${this.stats} .targetCpm=${this.targetCpm}></tt-practice>`
						: nothing}
					<tt-keyboard .resolved=${r} .active=${this.lastId}></tt-keyboard>
					<div class="row">
						<button class="btn" ?disabled=${!this.ready} @click=${() => this.#next()}>New line</button>
						<button class="btn ghost" @click=${() => (this.view = this.view === "type" ? "progress" : "type")}>${this.view === "type" ? "Progress" : "Back to typing"}</button>
						${this.#status(r)}
					</div>
				${this.view === "progress" && this.ready ? this.#stats() : nothing}
					${this.#notice(geo)}
				</div>
			</main>
			<!-- One pane for both layouts: a column on a desktop, a drawer under 900px. The scrim is inert on a
				desktop and is what dismisses the drawer on a phone. -->
			<div class="scrim" ?inert=${!this.panelOpen} @click=${() => this.#panel(false)}></div>
			<tt-insight-panel .cards=${this.#cards()} .open=${this.panelOpen} @panel-toggle=${(e: Event) => this.#panel((e as CustomEvent<boolean>).detail)}>
				${this.#history()}
			</tt-insight-panel>
		`;
	}

	// Numbers above the line, where the eyes already are. All four come from state the parent already
	// keeps, so they are right on the first paint after a reload, before a single key is pressed.
	#readout() {
		const cell = (label: string, value: string) => html`<div class="metric"><span class="label">${label}</span><b>${value}</b></div>`;
		const o = this.#overview();
		return html`
			<div class="read">
				${cell("now", `${cpmToWpm(this.nowCpm)} wpm`)}
				${cell("avg", `${o.avgWpm} wpm`)}
				${cell("goal", `${cpmToWpm(this.targetCpm)} wpm`)}
			</div>
		`;
	}

	// The screen reads from the same derived numbers as the ladder, so "at goal" here and "unlocks next"
	// in the engine cannot mean different things.
	#overview() {
		const r = this.#resolved;
		// A space has to be spelled out: it is the most-struck key on the board and an invisible row label
		// reads as a bug in the screen rather than as the space bar. Keys with no character at all (an
		// unmapped pinky column) fall back to their id, which is at least something to point at.
		const keys: KeyInfo[] = r.keys.map((k) => ({ id: k.id, label: keyLabel(k), hand: k.hand === "l" ? "left" : "right" }));
		const unlocked = this.settings.unlocked?.length ? this.settings.unlocked : keys.map((k) => k.id).slice(0, 9);
		return overview(this.stats, this.targetCpm, keys, unlocked);
	}

	#stats() {
		const o = this.#overview();
		const chips = (list: typeof o.keys) => html`<span class="chips">${list.map((k) => html`<span class="chip" title="no samples yet">${k.label}</span>`)}</span>`;
		// "waiting" is every key with no samples, unlocked or not; the locked ones are the rest.
		const stillLocked = o.waiting.filter((k) => !o.untried.some((u) => u.id === k.id));
		// One scale for every row, goal in the middle: the tick is at 50% here and in barWidth, and the two
		// must not drift or the chart reads as "past the line" for keys that are not.
		const row = (k: (typeof o.keys)[number]) => html`
			<div class="krow ${k.next ? "next" : ""}">
				<span class="cap">${k.label}</span>
				<span class="track"><span class="bar ${k.conf < 1 ? "bad" : ""}" style="width:${barWidth(k.ms, this.#goalMs())}%"></span><span class="mark" style="left:${GOAL_AT}%"></span></span>
				<span class="num">${k.wpm} wpm · ${k.ms}ms${k.errors ? ` · ${k.errors} miss` : ""}</span>
			</div>
		`;
		// History is its own section, outside the keys branch. It comes from synced sessions, and a browser
		// that has typed nothing local can still hold a year of practice on its repo -- gating the chart on
		// local per-key stats hid exactly the person who most wants to see it.
		const keys = o.covered
			? html`
					<div class="grid">
						${card("average", `${o.avgWpm} wpm`)} ${card("at goal", `${o.readyPct}%`)} ${card("errors", `${o.errPct}%`)} ${card("keys", `${o.covered}/${o.total}`)}
						${card("hands", `${o.handBalance}/${100 - o.handBalance}`)}
					</div>
					<p class="empty">${o.slowest.length ? `Slowest: ${o.slowest.map((k) => k.label).join(", ")}. The lesson weights those keys already.` : ""}</p>
					<div class="rows">${o.measured.map(row)}</div>
					${o.untried.length ? html`<p class="empty">Unlocked but never practised ${chips(o.untried)}</p>` : nothing}
					${stillLocked.length ? html`<p class="empty">Still locked ${chips(stillLocked)}</p>` : nothing}
				`
			: html`<p class="empty">A key gets a bar once you have hit it correctly. Hit the highlighted letter to start.</p>`;
		return html`
			<section class="stats">
				<h2>progress</h2>
				${keys}
			</section>
		`;
	}

	#goalMs() {
		return this.targetCpm <= 0 ? 0 : Math.round(60000 / this.targetCpm);
	}

	// The practice history, drawn as a section of the insight pane rather than of the progress screen. It is
	// slotted, not passed in as data: the SVG is built from d3 scales in this file, and a template handed to a
	// child would be styled by the child's stylesheet, which knows nothing about .chart or .trend.
	//
	// Practice history for the board you are on: speed on a Go60 says nothing about the same fingers on a
	// Corne, so this is filtered by layout exactly like the key bars beside it. The character count here is
	// the honest one the key screen could not show: it adds up what each session recorded, where per-key
	// `samples` is a weighted mean and sums to nothing meaningful.
	#history() {
		const key = layoutKey(this.geometryId, this.keymapId);
		// The demo flag replaces the source rather than overlaying it: two half-truths merged into one curve
		// would be the least legible chart this app could draw.
		const source = this.demo ? demoSessions(key) : this.sessions;
		const mine = source.filter((s) => s.layout === key);
		if (!mine.length) {
			// A preview deploy is the same artifact as production, so the hostname is the only way to know this
			// is a branch preview -- and on one, an empty chart tells a reviewer nothing. The data stays opt-in:
			// generated per render, labelled, never written to storage or to a repo.
			if (this.sessions.length || !isPreviewHost(location.hostname, __APP_NAME__)) return nothing;
			return html`
			<div class="hist" slot="hist">
				<h3>history · ${geometryById(this.geometryId).name}</h3>
				<p class="demo-note">
					<b>preview</b> No synced sessions yet.
					<button class="link" @click=${() => this.#demo(true)}>Show demo sessions</button>
				</p>
			</div>
			`;
		}
		const h = buildHistory(mine);
		const pts = series(h, 40);
		const goal = cpmToWpm(this.targetCpm);
		// d3 for the maths, Lit for the DOM. d3-selection would create and patch these nodes itself, and two
		// owners of one subtree is how a chart ends up rendering state the component has already dropped.
		// scaleBand over the day KEYS, so a skipped day still consumes a slot and the gap is real position.
		const x = scaleBand<string>().domain(pts.map((p) => p.day)).range([CH.pad.l, CH.w - CH.pad.r]).padding(0.3);
		// .nice() after the domain is set -- scaleLinear([0, n]) would read that array as the RANGE.
		const y = scaleLinear()
			.domain([0, Math.max(goal * 1.2, max(pts, (p) => Math.max(p.wpm, p.strokeWpm)) ?? 0, 10)])
			.range([CH.h - CH.pad.b, CH.pad.t])
			.nice();
		const every = Math.max(1, Math.ceil(pts.length / 5)); // about five date labels at any span
		const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
		const mid = (day: string) => (x(day) ?? 0) + x.bandwidth() / 2;
		const data = pts.filter((p) => p.sessions > 0);
		// .defined() is the whole trick of drawing a line honestly over a practice history: a day with no
		// sessions breaks the path instead of letting it slope down through a day you were not at the
		// keyboard. Rest days stay visible as the gap between two segments.
		const trend = line<Point>()
			.defined((p) => p.sessions > 0)
			.x((p) => mid(p.day))
			.y((p) => y(p.wpm));
		// A day whose sessions carry no per-key stats has no stroke measurement at all. It must draw the clock
		// line and nothing else: treating strokeWpm 0 as "zero typing time" would shade the entire band under
		// the curve as pausing, which is the opposite of what is known about that day.
		const stroked = (p: Point) => p.sessions > 0 && p.strokeWpm > 0;
		const typing = line<Point>()
			.defined(stroked)
			.x((p) => mid(p.day))
			.y((p) => y(p.strokeWpm));
		// The band between the two lines IS the hesitation: same characters, the gap is the time they did not
		// take. Filled rather than left as white space, because the emptiness is the finding.
		const gap = area<Point>()
			.defined(stroked)
			.x((p) => mid(p.day))
			.y0((p) => y(p.wpm))
			.y1((p) => y(p.strokeWpm));
		return html`
			<div class="hist" slot="hist">
				<h3>history · ${geometryById(this.geometryId).name}</h3>
				${this.demo
							? html`<p class="demo-note">
										<b>demo sessions</b> — nothing here is your progress, and none of it is stored or synced.
										<button class="link" @click=${() => this.#demo(false)}>Use real data</button>
									</p>`
							: nothing}
					<div class="grid">
					${card("sessions", `${h.sessions}`)} ${card("characters", `${h.chars}`)} ${card("practised", `${h.minutes} min`)} ${card("streak", `${h.streak} d`)}
					${card("best day", `${h.best?.wpm ?? 0} wpm`)}
				</div>
				<svg
					viewBox="0 0 ${CH.w} ${CH.h}"
					class="chart"
					role="img"
					aria-label=${`${h.activeDays} days practised. Typing speed ${h.strokeWpm} wpm, with pauses ${h.wpm} wpm. Best day ${h.best?.wpm ?? 0} wpm, goal ${goal} wpm.`}
				>
					${y
						.ticks(4)
							.filter((v) => v > 0)
							.map(
								(v) => svg`
									<g class="grid"><line x1=${CH.pad.l} x2=${CH.w - CH.pad.r} y1=${y(v)} y2=${y(v)} /><text x=${CH.pad.l - 5} y=${y(v)} dy="0.32em" text-anchor="end">${v}</text></g>
								`,
							)}
					<line class="axis" x1=${CH.pad.l} x2=${CH.w - CH.pad.r} y1=${y(0)} y2=${y(0)} />
					<path class="gap" d=${gap(pts) ?? ""} />
					<line class="goal" x1=${CH.pad.l} x2=${CH.w - CH.pad.r} y1=${y(goal)} y2=${y(goal)} />
					<path class="typing" d=${typing(pts) ?? ""} />
					<path class="trend" d=${trend(pts) ?? ""} />
					${data.map((p) => svg`<circle data-day=${p.day} cx=${mid(p.day)} cy=${y(p.wpm)} r="2.4" class=${p.wpm >= goal ? "ok" : "under"}><title>${`${p.day}: ${p.wpm} wpm with pauses, ${p.strokeWpm} wpm typing only, over ${p.minutes} min, ${p.sessions} session(s)`}</title></circle>`)}
					${pts
						.filter((_, i) => i % every === 0)
						.map((p) => svg`<text class="tick" x=${mid(p.day)} y=${CH.h - CH.pad.b + 11} text-anchor="middle">${fmt.format(parseDay(p.day))}</text>`)}
					<text class="goal-label" x=${CH.w - CH.pad.r} y=${y(goal)} dy="-3" text-anchor="end">goal ${goal}</text>
				</svg>
				<p class="legend">
					<span class="key typing"></span>typing only
					<span class="gapkey"></span>time spent not typing
					<span class="key clock"></span>what the clock said
				</p>
				<p class="empty">
					${h.activeDays} day${h.activeDays === 1 ? "" : "s"} practised${source.length > mine.length ? `, plus ${source.length - mine.length} session(s) on other boards` : ""}. The repo keeps
					the newest 50 sessions per layout, so these totals are that window rather than your whole life
					${h.undated ? `, and ${h.undated} session(s) had no readable date` : ""}.
				</p>
			</div>
		`;
	}

	// The pane is a child of the shell, not of the history screen, so it can be the full height of the window.
	// That means the insight cards are assembled here rather than inside the section they sit under, and the two
	// must select the same rows the chart is drawing -- demo or real, this layout only.
	#cards(): PanelCard[] {
		const key = layoutKey(this.geometryId, this.keymapId);
		const source = this.demo ? demoSessions(key) : this.sessions;
		return insightPanel(source.filter((s) => s.layout === key), this.targetCpm);
	}

	#panel(on: boolean): void {
		this.panelOpen = on;
		localStorage.setItem(PANEL_OPEN_KEY, on ? "1" : "0");
	}

	// Escape dismisses the pane. On a phone that is the only way out besides the scrim and the header button,
	// and it must not fire while the settings modal has the keyboard.
	#onEsc = (e: KeyboardEvent): void => {
		if (e.key === "Escape" && !this.settingsOpen && this.panelOpen) this.#panel(false);
	};

	// Turning demo data on also puts it in the URL, so a preview link that shows a chart still shows one
	// after a reload or when forwarded onward. Turning it off removes the parameter and the rows with it:
	// nothing is left in storage, because nothing was ever written there.
	#demo(on: boolean): void {
		this.demo = on;
		// Query built through URLSearchParams, which cannot throw, rather than parsing location.href: the
		// page could be served from a path with characters a URL constructor would reject, and a settings
		// toggle must never be the thing that raises.
		const q = new URLSearchParams(location.search);
		if (on) q.set("demo", "");
		else q.delete("demo");
		const s = q.toString();
		history.replaceState(null, "", location.pathname + (s ? `?${s}` : "") + location.hash);
	}

	// Clicks on the ::backdrop land on the dialog element itself, not on its children.
	#onDialogClick = (e: MouseEvent): void => {
		if (e.target === this.renderRoot.querySelector("dialog")) this.settingsOpen = false;
	};

	// Imported boards are the user's own data, so they get a different note than our reconstructions.
	#notice(geo: Geometry) {
		if (geo.id.startsWith("import:")) return html`<p class="warn row">Positions came from ${geo.source}. Compare the drawing with your board before trusting it.</p>`;
		return geo.verified ? nothing : html`<p class="warn row">Positions for ${geo.name} are our reconstruction, not the vendor's file.</p>`;
	}

	#status(r: Resolved) {
		const key = r.byId.get(this.lastId);
		if (!key) return html`<span class="label">keys</span> ${r.keys.length} mapped`;
		return html`<span class="label">last</span> <span class="hit">${key.char}</span> · ${key.id} · ${FINGER_NAME[key.finger]}`;
	}
}
customElements.define("app-main", AppMain);
