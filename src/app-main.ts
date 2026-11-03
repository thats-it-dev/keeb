import { LitElement, html, css, nothing } from "https://kit.thatsit.app/lit.js";
import { sharedStyles } from "https://kit.thatsit.app/kit.js";
import { GEOMETRIES, allGeometries, forgetGeometry, geometryById, registerGeometry } from "./data/geometries.ts";
import { KEYMAPS, allKeymaps, forgetKeymap, keymapById, registerKeymap } from "./data/keymaps.ts";
import { deleteBoard, deleteMap, layoutKey, loadBoards, loadMaps, loadSettings, loadStats, loadSyncState, saveBoard, saveMap, saveSettings, saveStats, saveSyncState, DEFAULT_SETTINGS, type Settings } from "./data/store.ts";
import { auth } from "./atproto/auth.ts";
import { Sync, type SyncState } from "./atproto/sync.ts";
import { mergeProgress } from "./atproto/records.ts";
import { cpmFrom, timeToTypeMs, type StatMap } from "./stats/stats.ts";
import { resolve, type Resolved } from "./keyboard/resolve.ts";
import { FINGER_NAME, type Geometry, type Keymap } from "./keyboard/types.ts";
import { geometryFromLayout, importId, importName } from "./layout/parse.ts";
import { isKeycapFile, keymapFromKeycap, type KeycapFile } from "./layout/keycap.ts";
import { iconSettings, iconTrash, iconX } from "./ui/icons.ts";
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

// Summing per-key samples gives the session totals without double-counting a repeated key.
function totals(stats: StatMap): { chars: number; errors: number } {
	let chars = 0;
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
	static properties = { geometryId: { state: true }, keymapId: { state: true }, ready: { state: true }, lastId: { state: true }, nowCpm: { state: true }, targetCpm: { state: true }, settingsOpen: { state: true }, boards: { state: true }, maps: { state: true }, importProblems: { state: true }, did: { state: true }, syncNote: { state: true } };
	static styles = [
		sharedStyles,
		css`
			main { display: grid; gap: 18px; padding: 18px; max-width: 62rem; margin: 0 auto; justify-items: center; }
			.head { display: flex; align-items: center; justify-content: space-between; gap: 14px; width: 100%; }
			.head h1 { margin: 0; }
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
		`,
	];

	geometryId = saved().g;
	settingsOpen = false;
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
		if (this.#bound) window.removeEventListener("keydown", this.#onKey);
		this.#bound = false;
		super.disconnectedCallback();
	}

	override updated(changed: Map<string, unknown>): void {
		if (changed.has("geometryId") || changed.has("keymapId")) void this.#load({ g: this.geometryId, k: this.keymapId });
		if (changed.has("settingsOpen")) this.#syncDialog();
		if (this.ready && !this.#bound) {
			window.addEventListener("keydown", this.#onKey);
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
		if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
		e.preventDefault();
		void this.#type(e.key);
	};

	async #type(ch: string): Promise<void> {
		const p = this.#practice;
		if (!p) return;
		const engine = p.engine;
		if (!this.#startedAt) this.#startSession();
		this.#armIdle();
		this.lastId = p.key(ch, performance.now()) ?? "";
		this.nowCpm = p.instantCpm;
		if (engine) await this.#flushStats(engine); // one write per keystroke, deduped inside
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
		const key = layoutKey(this.geometryId, this.keymapId);
		this.stats = { ...engine.stats };
		const previous = this.#saved;
		const now = JSON.stringify(engine.stats);
		if (previous === now) return; // nothing moved: wrong key, or the line is already finished
		this.#saved = now;
		await saveStats(key, this.stats);
		await saveSettings(key, { ...this.settings, geometry: this.geometryId, keymap: this.keymapId, targetCpm: this.targetCpm, unlocked: engine.ladder.unlocked });
	}

	#saved = "";

	#pick(part: "g" | "k", value: string): void {
		if (part === "g") this.geometryId = value;
		else this.keymapId = value;
	}

	#goal(e: Event): void {
		const v = Number((e.target as HTMLInputElement).value);
		if (Number.isFinite(v) && v >= 40 && v <= 600) this.targetCpm = Math.round(v);
	}

	// Bring the account and this browser into line, in whichever direction each piece is newer.
	async #syncNow(adapt = true): Promise<void> {
		if (!this.#sync) return;
		this.syncNote = "";
		const key = layoutKey(this.geometryId, this.keymapId);
		const { settings, progress } = await this.#sync.pull();
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
					<h1>${__APP_TITLE__}</h1>
					<button class="x" aria-label="Settings" aria-haspopup="dialog" .ariaExpanded=${this.settingsOpen ? "true" : "false"} @click=${() => (this.settingsOpen = true)}>${iconSettings}</button>
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
						<label><span class="label">goal cpm</span><input type="number" min="40" max="600" step="10" .value=${String(this.targetCpm)} @change=${this.#goal} /></label>
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
						${this.#status(r)}
					</div>
					${this.#notice(geo)}
				</div>
			</main>
		`;
	}

	// Numbers above the line, where the eyes already are. All four come from state the parent already
	// keeps, so they are right on the first paint after a reload, before a single key is pressed.
	#readout() {
		const cell = (label: string, value: string) => html`<div class="metric"><span class="label">${label}</span><b>${value}</b></div>`;
		const ids = Object.keys(this.stats);
		const avgMs = ids.length ? Math.round(ids.reduce((s, id) => s + timeToTypeMs(this.stats[id]!), 0) / ids.length) : 0;
		return html`
			<div class="read">
				${cell("now", `${this.nowCpm} cpm`)}
				${cell("session", `${avgMs ? cpmFrom(avgMs) : 0} cpm`)}
				${cell("avg", `${avgMs} ms/key`)}
				${cell("goal", `${this.targetCpm} cpm`)}
			</div>
		`;
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
