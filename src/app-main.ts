import { LitElement, html, css, nothing } from "https://kit.thatsit.app/lit.js";
import { sharedStyles } from "https://kit.thatsit.app/kit.js";
import { GEOMETRIES, geometryById } from "./data/geometries.ts";
import { KEYMAPS, keymapById } from "./data/keymaps.ts";
import { layoutKey, loadSettings, loadStats, saveSettings, saveStats, DEFAULT_SETTINGS, type Settings } from "./data/store.ts";
import { resolve, type Resolved } from "./keyboard/resolve.ts";
import { FINGER_NAME } from "./keyboard/types.ts";
import { iconSettings, iconX } from "./ui/icons.ts";
import "./keyboard/view.ts";
import "./lesson/practice.ts";
import type { TtPractice } from "./lesson/practice.ts";

// Which board and which keymap, per browser. Progress itself lives in IndexedDB.
const STORE = "touchtype:layout";

function saved(): { g: string; k: string } {
	try {
		const v = JSON.parse(localStorage.getItem(STORE) ?? "") as { g?: string; k?: string };
		if (typeof v.g === "string" && typeof v.k === "string" && GEOMETRIES.some((g) => g.id === v.g) && KEYMAPS.some((k) => k.id === v.k)) {
			return { g: v.g, k: v.k };
		}
	} catch {
		/* first run or junk in the slot */
	}
	return { g: GEOMETRIES[0].id, k: KEYMAPS[0].id };
}

export class AppMain extends LitElement {
	static properties = { geometryId: { state: true }, keymapId: { state: true }, ready: { state: true }, lastId: { state: true }, targetCpm: { state: true }, settingsOpen: { state: true } };
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
			.icon-btn { display: inline-flex; padding: 6px; border-radius: var(--radius); color: var(--text-secondary); }
			.icon-btn:hover { background: var(--code-bg); color: var(--text-primary); }
			.panel { display: grid; gap: 12px; padding: 16px 14px; }
			.panel label { display: grid; gap: 4px; justify-items: start; }
			.read { display: flex; gap: 26px; flex-wrap: wrap; justify-content: center; }
			.metric { display: grid; gap: 2px; justify-items: center; font-variant-numeric: tabular-nums; }
			.metric b { font-weight: 600; font-size: 1.05rem; }
			.row { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; justify-content: center; }
			.hit { color: var(--primary); font-weight: 600; }
			.warn { color: var(--text-muted); }
		`,
	];

	geometryId = saved().g;
	settingsOpen = false;
	keymapId = saved().k;
	// False until IndexedDB has answered; the lesson needs past stats to choose its keys.
	ready = false;
	lastId = "";
	targetCpm = DEFAULT_SETTINGS.targetCpm;
	stats = {};
	settings: Settings = DEFAULT_SETTINGS;
	#cache: { g: string; k: string; r: Resolved } | undefined;
	#bound = false;
	// Identifies the newest layout load, so an old IndexedDB answer cannot overwrite a newer choice.
	#pending: symbol | undefined;

	override firstUpdated(): void {
		void this.#load(saved());
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
		this.lastId = p.key(ch, performance.now()) ?? "";
		if (engine) await this.#flushStats(engine); // one write per keystroke, deduped inside
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

	#next(): void {
		const p = this.#practice;
		if (!p) return;
		void this.#flush(p);
		p.begin();
	}

	override render() {
		const r = this.#resolved;
		const geo = geometryById(this.geometryId);
		const p = this.#practice;
		return html`
			<main>
				<div class="head">
					<h1>${__APP_TITLE__}</h1>
					<button class="btn ghost" aria-haspopup="dialog" .ariaExpanded=${this.settingsOpen ? "true" : "false"} @click=${() => (this.settingsOpen = true)}>
						${iconSettings}<span>Settings</span>
					</button>
				</div>
				<dialog @close=${() => (this.settingsOpen = false)} @click=${this.#onDialogClick} aria-label="Settings">
					<div class="modal-head">
						<span class="label">settings</span>
						<button class="icon-btn" aria-label="Close settings" @click=${() => (this.settingsOpen = false)}>${iconX}</button>
					</div>
					<div class="panel">
						<label><span class="label">keyboard</span><select @change=${(e: Event) => this.#pick("g", (e.target as HTMLSelectElement).value)}>
								${GEOMETRIES.map((g) => html`<option value=${g.id} ?selected=${g.id === this.geometryId}>${g.name}</option>`)}
							</select></label>
						<label><span class="label">keymap</span><select @change=${(e: Event) => this.#pick("k", (e.target as HTMLSelectElement).value)}>
								${KEYMAPS.map((k) => html`<option value=${k.id} ?selected=${k.id === this.keymapId}>${k.name}</option>`)}
							</select></label>
						<label><span class="label">goal cpm</span><input type="number" min="40" max="600" step="10" .value=${String(this.targetCpm)} @change=${this.#goal} /></label>
					</div>
				</dialog>
				<div class="col">
					${p ? this.#readout(p) : html`<div class="read"><span class="label">loading your progress…</span></div>`}
					${this.ready
						? html`<tt-practice .resolved=${r} .stats=${this.stats} .targetCpm=${this.targetCpm}></tt-practice>`
						: nothing}
					<tt-keyboard .resolved=${r} .active=${this.lastId}></tt-keyboard>
					<div class="row">
						<button class="btn" ?disabled=${!this.ready} @click=${() => this.#next()}>New line</button>
						${this.#status(r)}
					</div>
					${geo.verified ? nothing : html`<p class="warn row">Positions for ${geo.name} are our reconstruction, not the vendor's file.</p>`}
				</div>
			</main>
		`;
	}

	// Numbers above the line, where the eyes already are. They read from the practice element, whose
	// fields are reactive, so every keystroke repaints this row. `?hidden` keeps the node alive.
	#readout(p: TtPractice) {
		const cell = (label: string, value: string) => html`<div class="metric"><span class="label">${label}</span><b>${value}</b></div>`;
		return html`
			<div class="read">
				${cell("now", `${p.instantCpm} cpm`)}
				${cell("session", `${p.sessionCpm} cpm`)}
				${cell("avg", `${p.avgMs} ms/key`)}
				${cell("goal", `${p.targetCpm} cpm`)}
			</div>
		`;
	}

	// Clicks on the ::backdrop land on the dialog element itself, not on its children.
	#onDialogClick = (e: MouseEvent): void => {
		if (e.target === this.renderRoot.querySelector("dialog")) this.settingsOpen = false;
	};

	#status(r: Resolved) {
		const key = r.byId.get(this.lastId);
		if (!key) return html`<span class="label">keys</span> ${r.keys.length} mapped`;
		return html`<span class="label">last</span> <span class="hit">${key.char}</span> · ${key.id} · ${FINGER_NAME[key.finger]}`;
	}
}
customElements.define("app-main", AppMain);
