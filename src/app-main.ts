import { LitElement, html, nothing } from "https://kit.thatsit.app/lit.js";
import { allGeometries, geometryById } from "./data/geometries.ts";
import { allKeymaps, keymapById } from "./data/keymaps.ts";
import { layoutKey, loadHistory, loadSettings, loadStats, saveSettings, DEFAULT_SETTINGS, type Settings } from "./data/store.ts";
import { type SessionRow } from "./atproto/records.ts";
import { dailyGoal } from "./stats/daily.ts";
import { DailyTally, savedDailyGoalMin, setDailyGoalMin } from "./app/daily.ts";
import { dailyBar } from "./ui/daily-bar.ts";
import { cpmToWpm, targetTimeMs, wpmToCpm, type StatMap } from "./stats/stats.ts";
import { ladder } from "./lesson/ladder.ts";
import { overview, type KeyInfo } from "./stats/overview.ts";
import { historySection } from "./stats/history-section.ts";
import { insightPanel, type PanelCard } from "./stats/panel.ts";
import { isPreviewHost, paneSessions } from "./stats/demo.ts";
import { resolve, keyLabel, type Resolved } from "./keyboard/resolve.ts";
import type { Geometry, Keymap } from "./keyboard/types.ts";
import { iconSettings } from "./ui/icons.ts";
import { countItems, insightCards } from "./ui/insight-cards.ts";
import { appStyles } from "./ui/app-styles.ts";
import { settingsDialog, syncDialog } from "./ui/settings-dialog.ts";
import { progressSection } from "./stats/progress-section.ts";
import { boardNotice, lastKey, readout } from "./ui/practice-line.ts";
import { Account } from "./app/account.ts";
import { importLayout, loadLayouts, removeBoard, removeMap, type LayoutChange } from "./app/boards.ts";
import { rememberSelection, savedSelection } from "./app/selection.ts";
import { demoFromUrl, rememberDemoInUrl } from "./app/pane-state.ts";
import { SessionRecorder } from "./app/session.ts";
import "./keyboard/view.ts";
import "./lesson/practice.ts";
import type { TtPractice } from "./lesson/practice.ts";

export class AppMain extends LitElement {
	static properties = { geometryId: { state: true }, keymapId: { state: true }, ready: { state: true }, lastId: { state: true }, nowCpm: { state: true }, targetCpm: { state: true }, settingsOpen: { state: true }, sessions: { state: true }, demo: { state: true }, boards: { state: true }, maps: { state: true }, importProblems: { state: true }, did: { state: true }, syncNote: { state: true }, keyboardOrder: { state: true }, realWords: { state: true }, dailyGoalMin: { state: true } };
	static styles = appStyles;

	geometryId = savedSelection().g;
	settingsOpen = false;
	// Practice sessions as the PDS keeps them, cached in IndexedDB. Empty until something has synced.
	sessions: SessionRow[] = [];
	// Fake history for previews, switched on by ?demo=1. Generated per render and never stored anywhere:
	// a preview visit must not be able to write a made-up session into a real repo or a real device.
	demo = demoFromUrl();
	keymapId = savedSelection().k;
	// Which letters the lesson hands out, and where it gets its words from. Both live in the stored
	// settings; these are the reactive copies the page renders from.
	keyboardOrder = false;
	realWords = false;
	// Layout files the learner imported, straight out of IndexedDB.
	boards: Geometry[] = [];
	maps: Keymap[] = [];
	importProblems: string[] = [];
	// Signed-in account, and the one line the sync layer is allowed to say out loud. The account owns the
	// truth; these two fields are the render-visible copy it pushes through invalidate().
	did = "";
	syncNote = "";
	#tally = new DailyTally(() => this.requestUpdate());
	dailyGoalMin = savedDailyGoalMin(); // this browser's slot, not per-layout settings: the minutes are device-wide
	#account: Account = new Account({
		read: () => ({ geometryId: this.geometryId, keymapId: this.keymapId, targetCpm: this.targetCpm, keyboardOrder: this.keyboardOrder, realWords: this.realWords, stats: this.stats, sessions: this.sessions, layouts: { boards: this.boards, maps: this.maps } }),
		writeStats: (stats) => (this.stats = stats),
		writeSessions: (sessions) => (this.sessions = sessions),
		writeLayouts: ({ boards, maps }) => {
			this.boards = boards;
			this.maps = maps;
		},
		writeGoal: (targetCpm) => (this.targetCpm = targetCpm),
		writeCurriculum: (curriculum) => {
			this.settings = { ...this.settings, ...curriculum };
			this.keyboardOrder = curriculum.keyboardOrder ?? this.keyboardOrder;
			this.realWords = curriculum.realWords ?? this.realWords;
		},
		reload: () => void this.#load({ g: this.geometryId, k: this.keymapId }),
		pick: (geometryId, keymapId) => {
			this.#pick("g", geometryId);
			this.#pick("k", keymapId);
		},
		select: (geometryId, keymapId) => {
			this.geometryId = geometryId;
			this.keymapId = keymapId;
		},
		endSession: (): Promise<void> => this.#session.end(),
		invalidate: () => {
			this.did = this.#account.did;
			this.syncNote = this.#account.note;
			this.requestUpdate();
		},
	});
	// The practice session: what the counters read when it started, and the silence that closes it.
	#session: SessionRecorder = new SessionRecorder({
		read: () => ({ key: layoutKey(this.geometryId, this.keymapId), geometryId: this.geometryId, keymapId: this.keymapId, stats: this.stats, settings: this.settings, targetCpm: this.targetCpm }),
		writeStats: (stats) => (this.stats = stats),
		note: (line) => (this.syncNote = line),
		connected: (): boolean => this.#account.connected,
		recordDay: (ms) => this.#tally.record(ms),
		deliver: (session): Promise<{ sent?: number; error?: string }> => this.#account.pushSession(session),
	});
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
			window.addEventListener("pagehide", () => void this.#session.end());
		});
		// Kept out of the call above on purpose. The lesson cannot start until that one resolves, and cached
		// sessions are an add-on: a history store that rejects or stalls must never be why nobody can type.
		void loadHistory()
			.then((sessions) => {
				this.sessions = sessions;
			})
			.catch(() => undefined);
		this.#tally.load();
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
		if (changed.has("settingsOpen")) syncDialog(this.renderRoot, this.settingsOpen);
		if (this.ready && !this.#bound) {
			window.addEventListener("keydown", this.#onKey);
			window.addEventListener("keydown", this.#onEsc);
			this.#bound = true;
		}
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
		this.keyboardOrder = this.settings.keyboardOrder;
		this.realWords = this.settings.realWords;
		rememberSelection(sel);
		this.#session.seed(stored);
		this.stats = stored;
		this.targetCpm = this.settings.targetCpm;
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
		this.#session.begin();
		this.#session.arm();
		this.lastId = p.key(ch, performance.now()) ?? "";
		this.nowCpm = p.instantCpm;
		// Read the engine AFTER the keystroke. p.key() replaces it with a new object; holding the reference
		// from before the call would persist the stats as they stood one key ago — and on the very first
		// keystroke that is undefined, so nothing is saved at all.
		if (p.engine) await this.#session.stroke(p.engine);
	}

	#pick(part: "g" | "k", value: string): void {
		// Close the session while the old layout is still selected. #load replaces this.stats with the new
		// layout's map, and the session's end computes a delta against the baseline it took from the OLD one —
		// that difference is usually negative, and a negative delta is discarded, so switching mid-session
		// would silently lose the characters you had just typed.
		if (part === "g" ? value !== this.geometryId : value !== this.keymapId) void this.#session.end();
		if (part === "g") this.geometryId = value;
		else this.keymapId = value;
	}

	// The field is words per minute; the stored goal stays characters per minute, so the number that goes
	// to the PDS and drives the ladder does not depend on a word ever being five letters.
	#goal(e: Event): void {
		const v = Number((e.target as HTMLInputElement).value);
		if (Number.isFinite(v) && v >= 15 && v <= 120) this.targetCpm = wpmToCpm(v);
	}

	// The two curriculum switches. They are stored with the goal, and they change which letters are in play,
	// so the practice pane restarts its line on them.
	#curriculum(part: "keyboardOrder" | "realWords", on: boolean): void {
		this.settings = { ...this.settings, [part]: on };
		if (part === "keyboardOrder") this.keyboardOrder = on;
		else this.realWords = on;
		void saveSettings(layoutKey(this.geometryId, this.keymapId), { ...this.settings, targetCpm: this.targetCpm });
	}

	// The file picker: what a layout file means is app/boards.ts's business, and this only says which list
	// on screen the result belongs to.
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
		if (p.engine) void this.#session.stroke(p.engine);
		p.begin();
	}

	override render() {
		const r = this.#resolved;
		const geo = geometryById(this.geometryId);
		const cards = this.#cards();
		// Once per render: the readout, the progress rows and the ring on the board all have to agree about
		// which letter the lesson is built around, and three calls to #overview() would be three chances to
		// disagree about the stats it reads.
		const o = this.ready ? this.#overview() : undefined;
		// The insights panel is the kit shell's aside: a docked column from 900px, a drawer below it. The shell
		// owns the folding, the drawer, the Escape key and the remembered choice (store-key); it starts open
		// only on a branch preview, where the history section carries the only demo-sessions prompt.
		return html`
			<tk-shell store-key=${`${__APP_NAME__}:panels`} aside-label="Insights" ?aside-hidden=${!isPreviewHost(location.hostname, __APP_NAME__)}>
				<div class="page">
					<tk-header aside-label="Insights" aside-badge=${String(countItems(cards))}>
						<h1 slot="title">${__APP_HEADING__}</h1>
						<button slot="actions" class="x" aria-label="Settings" aria-haspopup="dialog" .ariaExpanded=${this.settingsOpen ? "true" : "false"} @click=${() => (this.settingsOpen = true)}>${iconSettings}</button>
					</tk-header>
					<main>
						${settingsDialog({
							geometries: allGeometries(),
							keymaps: allKeymaps(),
							geometryId: this.geometryId,
							keymapId: this.keymapId,
							goalWpm: cpmToWpm(this.targetCpm),
							dailyGoalMin: this.dailyGoalMin,
							keyboardOrder: this.keyboardOrder,
							realWords: this.realWords,
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
							onDailyGoal: (e) => (this.dailyGoalMin = setDailyGoalMin(Number((e.target as HTMLInputElement).value)) ?? this.dailyGoalMin),
							onCurriculum: (part, on) => this.#curriculum(part, on),
							onUpload: (e) => void this.#upload(e),
							onHandle: (v) => (this.#account.handle = v),
							// Signing in, syncing and publishing are the account's business; see app/account.ts. Each leaves
							// the note the learner reads on this.#account.note.
							onSignIn: () => void this.#account.signIn(),
							onSignOut: () => void this.#account.signOut(),
							onSync: () => void this.#account.syncNow(),
							onPublish: () => void this.#account.publish(geometryById(this.geometryId), r.keys.map((key) => ({ id: key.id, char: key.char }))),
							onRemoveBoard: (id) => void this.#removeBoard(id),
							onRemoveMap: (id) => void this.#removeMap(id),
						})}
						<div class="col">
							${o ? readout({ nowWpm: cpmToWpm(this.nowCpm), avgWpm: o.avgWpm, goalWpm: cpmToWpm(this.targetCpm), focusLabel: o.focusLabel, acc: this.#session.sessionAccuracy() ?? undefined }) : html`<div class="read"><span class="label">loading your progress…</span></div>`}
							${dailyBar(dailyGoal(this.#tally.rows, Date.now(), this.#session.elapsed(), this.dailyGoalMin))}
							${this.ready
								? html`<tt-practice .resolved=${r} .stats=${this.stats} .targetCpm=${this.targetCpm} .keyboardOrder=${this.keyboardOrder} .realWords=${this.realWords}></tt-practice>`
								: nothing}
							<tt-keyboard .resolved=${r} .active=${this.lastId} .focusId=${o?.focusId ?? ""}></tt-keyboard>
							<div class="row">
								<button class="btn" ?disabled=${!this.ready} @click=${() => this.#next()}>New line</button>
								${lastKey(r, this.lastId)}
							</div>
							${boardNotice(geo)}
						</div>
					</main>
				</div>
				<section slot="aside" class="insights">
					${o ? progressSection(o, targetTimeMs(this.targetCpm)) : nothing}
					${this.#history()}
					${insightCards(cards)}
				</section>
			</tk-shell>
		`;
	}

	// The screen reads from the same derived numbers as the ladder, so "at goal" here and "unlocks next" in
	// the engine cannot mean different things. One call per render; the model behind it is memoised.
	#overview() {
		const r = this.#resolved;
		const keys: KeyInfo[] = r.keys.map((k) => ({ id: k.id, label: keyLabel(k), hand: k.hand === "l" ? "left" : "right" }));
		const l = ladder(r, this.stats, this.targetCpm, { keyboardOrder: this.keyboardOrder });
		return overview(this.stats, this.targetCpm, keys, { unlocked: l.unlocked, next: l.next, focus: l.focus });
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


	// The cards live with the pane, not with the section they describe, so both have to pick the same rows the
	// chart draws -- demo or real, this layout only.
	#cards(): PanelCard[] {
		return insightPanel(paneSessions(this.demo, layoutKey(this.geometryId, this.keymapId), this.sessions), this.targetCpm);
	}

	// Escape hides the docked column; the shell closes its own drawer on Escape, and the settings modal takes
	// the key before it can reach either. Asking through the shell's event keeps the layout state in the kit.
	#onEsc = (e: KeyboardEvent): void => {
		if (e.key !== "Escape" || this.settingsOpen) return;
		(this.renderRoot.querySelector(".page") as HTMLElement | null)?.dispatchEvent(new CustomEvent("tk-hide-panel", { detail: { panel: "aside" }, bubbles: true, composed: true }));
	};

	#demo(on: boolean): void {
		this.demo = on;
		rememberDemoInUrl(on);
	}

	// Clicks on the ::backdrop land on the dialog element itself, not on its children.
	#onDialogClick = (e: MouseEvent): void => {
		if (e.target === this.renderRoot.querySelector("dialog")) this.settingsOpen = false;
	};
}
customElements.define("app-main", AppMain);
