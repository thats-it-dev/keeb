import { LitElement, html, nothing } from "https://kit.thatsit.app/lit.js";
import { GEOMETRIES, allGeometries, forgetGeometry, geometryById, registerGeometry } from "./data/geometries.ts";
import { KEYMAPS, allKeymaps, forgetKeymap, keymapById, registerKeymap } from "./data/keymaps.ts";
import { applyRemoteProgress, deleteBoard, deleteMap, layoutKey, loadBoards, loadHistory, loadMaps, loadSettings, loadStats, loadSyncState, saveBoard, saveHistory, saveMap, saveSettings, saveStats, saveSyncState, DEFAULT_SETTINGS, type Settings } from "./data/store.ts";
import { auth } from "./atproto/auth.ts";
import { Sync, type SharedLayoutRow, type SyncState } from "./atproto/sync.ts";
import { boardFromLayout, layoutRecord, SHARED_PREFIX, type SessionRow } from "./atproto/records.ts";
import { cpmToWpm, targetTimeMs, wpmToCpm, type StatMap } from "./stats/stats.ts";
import { overview, type KeyInfo } from "./stats/overview.ts";
import { historySection } from "./stats/history-section.ts";
import { demoSessions, isPreviewHost } from "./stats/demo.ts";
import { insightPanel, type PanelCard } from "./stats/panel.ts";
import { PANEL_OPEN_KEY } from "./stats/panel-element.ts";
import { resolve, type Resolved } from "./keyboard/resolve.ts";
import { FINGER_NAME, type Geometry, type Keymap } from "./keyboard/types.ts";
import { geometryFromLayout, importId, importName } from "./layout/parse.ts";
import { isKeycapFile, keymapFromKeycap, type KeycapFile } from "./layout/keycap.ts";
import { iconPanelRight, iconSettings } from "./ui/icons.ts";
import { appStyles } from "./ui/app-styles.ts";
import { settingsDialog } from "./ui/settings-dialog.ts";
import { progressSection } from "./stats/progress-section.ts";
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
	static properties = { geometryId: { state: true }, keymapId: { state: true }, ready: { state: true }, lastId: { state: true }, nowCpm: { state: true }, targetCpm: { state: true }, settingsOpen: { state: true }, sessions: { state: true }, demo: { state: true }, boards: { state: true }, maps: { state: true }, importProblems: { state: true }, did: { state: true }, syncNote: { state: true }, panelOpen: { type: Boolean, attribute: "data-panel-open", reflect: true } };
	static styles = appStyles;

	geometryId = saved().g;
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

	/** Register and store one shared layout, if this browser does not already have it. Idempotent by id. */
	async #adoptShared(row: SharedLayoutRow): Promise<void> {
		const { geometry, keymap } = boardFromLayout(row.rkey, row.layout);
		if (!allGeometries().some((x) => x.id === geometry.id)) {
			registerGeometry(geometry);
			await saveBoard(geometry);
			this.boards = [...this.boards, geometry];
		}
		if (!allKeymaps().some((x) => x.id === keymap.id)) {
			registerKeymap(keymap);
			await saveMap(keymap);
			this.maps = [...this.maps, keymap];
		}
	}

	/**
	 * Publish the layout on screen, then adopt the record this device just wrote. Adopting is not a courtesy
	 * to the other browser: without it this one keeps typing under `import:whatever` while the account says
	 * `shared:<rkey>`, and the two never recognize each other again.
	 */
	async #publishLayout(): Promise<void> {
		if (!this.#sync) return;
		this.syncNote = "";
		const g = geometryById(this.geometryId);
		const k = keymapById(this.keymapId);
		const r = this.#resolved;
		const byKey: Record<string, string> = {};
		for (const key of r.keys) byKey[key.id] = key.char;
		try {
			const rkey = await this.#sync.pushLayout(layoutKey(g.id, k.id), layoutRecord(g.name, g.source, g, r.keys.map((key) => ({ id: key.id, char: key.char }))));
			await this.#adoptShared({ rkey, layout: { name: g.name, source: g.source, geometry: { split: g.split, rowRoles: g.rowRoles, keys: g.keys }, byKey } });
			const id = SHARED_PREFIX + rkey;
			this.#pick("g", id);
			this.#pick("k", id);
			await this.#syncNow(false);
			this.syncNote = "layout published";
		} catch (err) {
			this.syncNote = `layout not published: ${(err as Error).message}`;
		}
	}

	// Bring the account and this browser into line, in whichever direction each piece is newer.
	async #syncNow(adapt = true): Promise<void> {
		if (!this.#sync) return;
		this.syncNote = "";
		const key = layoutKey(this.geometryId, this.keymapId);
		const notes: string[] = [];
		try {
			const { settings, progress, sessions, layouts } = await this.#sync.pull();
			// Shared boards land before anything reads the settings record: the account may name a layout this
			// browser has never seen, and the adoption check below only accepts an id it can resolve.
			for (const row of layouts) await this.#adoptShared(row);
			await saveHistory(sessions);
			this.sessions = sessions;
			const remote = progress[key];
			if (remote) {
				// Only what the record has learned since the last fold counts. It carries this browser's own
				// pushed numbers, so folding it in whole added our strokes to our strokes — once per sync. The
				// memory of what was already folded lives in the sync row, which store.ts reads and writes in the
				// same transaction as the stats.
				const before = JSON.stringify(this.stats);
				this.stats = await applyRemoteProgress(key, remote);
				if (JSON.stringify(this.stats) !== before) {
					// The engine holds its own copy; rebuilding the lesson is what makes the merged speed count.
					void this.#load({ g: this.geometryId, k: this.keymapId });
				}
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
		} catch (err) {
			// A failed read must not cancel the writes below. The reason this device has anything queued is
			// that a write failed earlier; if the read had to succeed first, an unreachable PDS would strand the
			// outbox forever -- and it is how an InvalidRequest on pull() came to silence Sync entirely.
			notes.push(`read failed: ${(err as Error).message}`);
		}
		try {
			await this.#sync.pushSettings({ geometry: this.geometryId, keymap: this.keymapId, targetCpm: this.targetCpm, unlocked: [] }, Date.now());
		} catch (err) {
			notes.push(`settings not sent: ${(err as Error).message}`);
		}
		const queued = await this.#sync.flush(Date.now());
		this.syncNote = [...notes, queued.error ?? (queued.sent ? `${queued.sent} session(s) sent` : "up to date")].join(" · ");
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
				${settingsDialog({
					geometries: allGeometries(),
					keymaps: allKeymaps(),
					geometryId: this.geometryId,
					keymapId: this.keymapId,
					goalWpm: cpmToWpm(this.targetCpm),
					did: this.did,
					handle: this.#handle,
					syncNote: this.syncNote,
					boards: this.boards,
					maps: this.maps,
					problems: this.importProblems,
					onClose: (open) => (this.settingsOpen = open),
					onClick: this.#onDialogClick,
					onPick: (part, value) => this.#pick(part, value),
					onGoal: (e) => this.#goal(e),
					onUpload: (e) => void this.#upload(e),
					onHandle: (v) => (this.#handle = v),
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
