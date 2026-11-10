import { LitElement, html, nothing } from "https://kit.thatsit.app/lit.js";
import { allGeometries, geometryById } from "./data/geometries.ts";
import { allKeymaps, keymapById } from "./data/keymaps.ts";
import { layoutKey, loadHistory, loadSettings, loadStats, saveSettings, saveStats, DEFAULT_SETTINGS, type Settings } from "./data/store.ts";
import { type SessionRow } from "./atproto/records.ts";
import { cpmToWpm, targetTimeMs, totals, wpmToCpm, type StatMap } from "./stats/stats.ts";
import { overview, type KeyInfo } from "./stats/overview.ts";
import { historySection } from "./stats/history-section.ts";
import { demoSessions, isPreviewHost } from "./stats/demo.ts";
import { insightPanel, type PanelCard } from "./stats/panel.ts";
import { PANEL_OPEN_KEY } from "./stats/panel-element.ts";
import { resolve, keyLabel, type Resolved } from "./keyboard/resolve.ts";
import { FINGER_NAME, type Geometry, type Keymap } from "./keyboard/types.ts";
import { iconPanelRight, iconSettings } from "./ui/icons.ts";
import { appStyles } from "./ui/app-styles.ts";
import { settingsDialog } from "./ui/settings-dialog.ts";
import { progressSection } from "./stats/progress-section.ts";
import { Account } from "./app/account.ts";
import { importLayout, loadLayouts, removeBoard, removeMap, type LayoutChange } from "./app/boards.ts";
import { rememberSelection, savedSelection } from "./app/selection.ts";
import "./keyboard/view.ts";
import "./lesson/practice.ts";
import type { TtPractice } from "./lesson/practice.ts";

export class AppMain extends LitElement {
	static properties = { geometryId: { state: true }, keymapId: { state: true }, ready: { state: true }, lastId: { state: true }, nowCpm: { state: true }, targetCpm: { state: true }, settingsOpen: { state: true }, sessions: { state: true }, demo: { state: true }, boards: { state: true }, maps: { state: true }, importProblems: { state: true }, did: { state: true }, syncNote: { state: true }, panelOpen: { type: Boolean, attribute: "data-panel-open", reflect: true } };
	static styles = appStyles;

	geometryId = savedSelection().g;
	settingsOpen = false;
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
	keymapId = savedSelection().k;
	// Layout files the learner imported, straight out of IndexedDB.
	boards: Geometry[] = [];
	maps: Keymap[] = [];
	importProblems: string[] = [];
	// Signed-in account, and the one line the sync layer is allowed to say out loud. The account owns the
	// truth; these two fields are the render-visible copy it pushes through invalidate().
	did = "";
	syncNote = "";
	#account = new Account({
		read: () => ({ geometryId: this.geometryId, keymapId: this.keymapId, targetCpm: this.targetCpm, stats: this.stats, sessions: this.sessions, layouts: { boards: this.boards, maps: this.maps } }),
		writeStats: (stats) => (this.stats = stats),
		writeSessions: (sessions) => (this.sessions = sessions),
		writeLayouts: ({ boards, maps }) => {
			this.boards = boards;
			this.maps = maps;
		},
		writeGoal: (targetCpm) => (this.targetCpm = targetCpm),
		reload: () => void this.#load({ g: this.geometryId, k: this.keymapId }),
		pick: (geometryId, keymapId) => {
			this.#pick("g", geometryId);
			this.#pick("k", keymapId);
		},
		select: (geometryId, keymapId) => {
			this.geometryId = geometryId;
			this.keymapId = keymapId;
		},
		endSession: () => this.#endSession(),
		invalidate: () => {
			this.did = this.#account.did;
			this.syncNote = this.#account.note;
			this.requestUpdate();
		},
	});
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
		// re-assigned afterwards: the field initializers called savedSelection() against an empty registry, so
		// they hold the shipped defaults even when the stored choice says otherwise.
		void loadLayouts().then((layouts) => {
			this.boards = layouts.boards;
			this.maps = layouts.maps;
			const sel = savedSelection();
			const moved = sel.g !== this.geometryId || sel.k !== this.keymapId;
			this.geometryId = sel.g;
			this.keymapId = sel.k;
			// updated() reloads when an id changed; when nothing moved this is the only place that loads.
			if (!moved) void this.#load(sel);
			void this.#account.boot();
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
		rememberSelection(sel);
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
		if (chars <= 0 || !this.#account.connected) return; // offline-first: the practice data is already in IndexedDB
		const res = await this.#account.pushSession({ chars, errors, ms, stats: this.stats });
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

	// Sync, sign-in and publishing are the account's business; see app/account.ts. These are the three
	// hooks the screen needs, and every one of them leaves the note for the learner on this.#account.note.
	async #syncNow(adapt = true): Promise<void> {
		await this.#account.syncNow(adapt);
	}

	async #signIn(): Promise<void> {
		await this.#account.signIn();
	}

	async #signOut(): Promise<void> {
		await this.#account.signOut();
	}

	async #publishLayout(): Promise<void> {
		await this.#account.publish(geometryById(this.geometryId), this.#resolved.keys.map((key) => ({ id: key.id, char: key.char })));
	}

	// Read a layout file the learner picked. Two shapes arrive here: a keyboard-layout-editor
	// info.json, which describes a board's positions, and a MoErgo Layout Editor export, which names a
	// board and gives the characters. The same control takes either.
	async #upload(e: Event): Promise<void> {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		this.#applyLayout(await importLayout(await file.text(), file.name, { boards: this.boards, maps: this.maps }, this.geometryId));
	}

	async #removeMap(id: string): Promise<void> {
		const next = await removeMap(id, { boards: this.boards, maps: this.maps }, this.keymapId);
		this.maps = next.maps;
		this.keymapId = next.keymapId;
	}

	async #removeBoard(id: string): Promise<void> {
		const next = await removeBoard(id, { boards: this.boards, maps: this.maps }, this.geometryId);
		this.boards = next.boards;
		this.geometryId = next.geometryId;
	}

	// One place where an imported or shared layout reaches the screen: the lists, the selection, and the
	// problems the parser found, all from the same result object.
	#applyLayout(change: LayoutChange): void {
		if (change.problems) this.importProblems = change.problems;
		if (change.boards) this.boards = change.boards;
		if (change.maps) this.maps = change.maps;
		if (change.geometryId) this.geometryId = change.geometryId;
		if (change.keymapId) this.keymapId = change.keymapId;
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
				${settingsDialog({
					geometries: allGeometries(),
					keymaps: allKeymaps(),
					geometryId: this.geometryId,
					keymapId: this.keymapId,
					goalWpm: cpmToWpm(this.targetCpm),
					did: this.did,
					handle: this.#account.handle,
					syncNote: this.syncNote,
					boards: this.boards,
					maps: this.maps,
					problems: this.importProblems,
					onClose: (open) => (this.settingsOpen = open),
					onClick: this.#onDialogClick,
					onPick: (part, value) => this.#pick(part, value),
					onGoal: (e) => this.#goal(e),
					onUpload: (e) => void this.#upload(e),
					onHandle: (v) => (this.#account.handle = v),
					onSignIn: () => void this.#signIn(),
					onSignOut: () => void this.#signOut(),
					onSync: () => void this.#syncNow(),
					onPublish: () => void this.#publishLayout(),
					onRemoveBoard: (id) => void this.#removeBoard(id),
					onRemoveMap: (id) => void this.#removeMap(id),
				})}
				<div class="col">
					${this.ready ? this.#readout() : html`<div class="read"><span class="label">loading your progress…</span></div>`}
					${this.ready
						? html`<tt-practice .resolved=${r} .stats=${this.stats} .targetCpm=${this.targetCpm}></tt-practice>`
						: nothing}
					<tt-keyboard .resolved=${r} .active=${this.lastId}></tt-keyboard>
					<div class="row">
						<button class="btn" ?disabled=${!this.ready} @click=${() => this.#next()}>New line</button>
						${this.#status(r)}
					</div>
					${this.#notice(geo)}
				</div>
			</main>
			<!-- One pane for both layouts: a column on a desktop, a drawer under 900px. The scrim is inert on a
				desktop and is what dismisses the drawer on a phone. -->
			<div class="scrim" ?inert=${!this.panelOpen} @click=${() => this.#panel(false)}></div>
			<tt-insight-panel .cards=${this.#cards()} .open=${this.panelOpen} @panel-toggle=${(e: Event) => this.#panel((e as CustomEvent<boolean>).detail)}>
				${this.ready ? this.#stats() : nothing}
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
		return progressSection(this.#overview(), targetTimeMs(this.targetCpm));
	}


	#history() {
		return historySection({
			boardName: geometryById(this.geometryId).name,
			key: layoutKey(this.geometryId, this.keymapId),
			demo: this.demo,
			sessions: this.sessions,
			targetCpm: this.targetCpm,
			onDemo: (on) => this.#demo(on),
		});
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
