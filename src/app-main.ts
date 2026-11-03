import { LitElement, html, css } from "https://kit.thatsit.app/lit.js";
import { sharedStyles } from "https://kit.thatsit.app/kit.js";
import { GEOMETRIES, geometryById } from "./data/geometries.ts";
import { KEYMAPS, keymapById } from "./data/keymaps.ts";
import { resolve, type Resolved } from "./keyboard/resolve.ts";
import { FINGER_NAME } from "./keyboard/types.ts";
import "./keyboard/view.ts";

const STORE = "touchtype:layout";

function saved(): { g: string; k: string } {
	try {
		const v = JSON.parse(localStorage.getItem(STORE) ?? "") as { g?: string; k?: string };
		if (typeof v.g === "string" && typeof v.k === "string") return { g: v.g, k: v.k };
	} catch {
		/* first run or junk in the slot */
	}
	return { g: GEOMETRIES[0].id, k: KEYMAPS[0].id };
}

export class AppMain extends LitElement {
	static properties = { geometryId: { state: true }, keymapId: { state: true }, lastChar: { state: true }, lastId: { state: true }, typed: { state: true } };
	static styles = [
		sharedStyles,
		css`
			main { display: grid; gap: 14px; padding: 18px; max-width: 62rem; margin: 0 auto; }
			.picks { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
			.picks label { display: grid; gap: 4px; }
			tt-keyboard { display: block; }
			.row { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
			.hit { color: var(--primary); font-weight: 600; }
			.warn { color: var(--text-muted); }
		`,
	];

	geometryId = saved().g;
	keymapId = saved().k;
	lastChar = "";
	lastId = "";
	typed = 0;
	#cache: { g: string; k: string; r: Resolved } | undefined;

	get #resolved(): Resolved {
		if (!this.#cache || this.#cache.g !== this.geometryId || this.#cache.k !== this.keymapId) {
			this.#cache = { g: this.geometryId, k: this.keymapId, r: resolve(geometryById(this.geometryId), keymapById(this.keymapId)) };
		}
		return this.#cache.r;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("keydown", this.#onKey);
	}

	override disconnectedCallback(): void {
		window.removeEventListener("keydown", this.#onKey);
		super.disconnectedCallback();
	}

	#onKey = (e: KeyboardEvent): void => {
		const t = e.target as HTMLElement | null;
		if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
		if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
		e.preventDefault();
		this.lastChar = e.key;
		this.lastId = this.#resolved.byChar.get(e.key.toLowerCase()) ?? "";
		this.typed += 1;
	};

	#pick(part: "g" | "k", value: string): void {
		if (part === "g") this.geometryId = value;
		else this.keymapId = value;
		localStorage.setItem(STORE, JSON.stringify({ g: this.geometryId, k: this.keymapId }));
		this.#cache = undefined;
	}

	override render() {
		const r = this.#resolved;
		const geo = geometryById(this.geometryId);
		return html`
			<main>
				<h1>${__APP_TITLE__}</h1>
				<div class="picks">
					<label><span class="label">keyboard</span><select @change=${(e: Event) => this.#pick("g", (e.target as HTMLSelectElement).value)}>
							${GEOMETRIES.map((g) => html`<option value=${g.id} ?selected=${g.id === this.geometryId}>${g.name}</option>`)}
						</select></label>
					<label><span class="label">keymap</span><select @change=${(e: Event) => this.#pick("k", (e.target as HTMLSelectElement).value)}>
							${KEYMAPS.map((k) => html`<option value=${k.id} ?selected=${k.id === this.keymapId}>${k.name}</option>`)}
						</select></label>
				</div>
				<tt-keyboard .resolved=${r} .active=${this.lastId}></tt-keyboard>
				${this.#status(r)} ${geo.verified ? html`` : html`<p class="warn"><span class="label">note</span>Positions for ${geo.name} are our reconstruction, not the vendor's file.</p>`}
			</main>
		`;
	}

	#status(r: Resolved) {
		if (!this.lastChar) return html`<p class="row"><span class="label">status</span> Type to see which key you just pressed. ${r.keys.length} keys mapped.</p>`;
		const key = r.byId.get(this.lastId);
		if (!key) return html`<p class="row"><span class="label">last</span> <span class="hit">${this.lastChar}</span> is not on ${geometryById(this.geometryId).name}.</p>`;
		return html`<p class="row"><span class="label">last</span> <span class="hit">${this.lastChar}</span> · ${key.id} · ${FINGER_NAME[key.finger]}</p>`;
	}
}
customElements.define("app-main", AppMain);
