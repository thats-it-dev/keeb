import { LitElement, html, css } from "https://kit.thatsit.app/lit.js";
import { press, start } from "../lesson/engine.ts";
import { cpmFrom, timeToTypeMs, type StatMap } from "../stats/stats.ts";
import type { Resolved } from "../keyboard/resolve.ts";

// The typing pane. It owns the lesson engine and reports every keystroke back up, so the keyboard
// view can highlight the key and the store can persist it.
export class TtPractice extends LitElement {
	static properties = { resolved: { type: Object }, targetCpm: { type: Number }, stats: { type: Object }, cursor: { state: true } };
	static styles = css`
		.line { font-size: 1.2rem; line-height: 2; padding: 12px; border: 1px solid var(--border-color); border-radius: var(--radius); background: var(--bg); word-break: break-word; }
		.done { color: var(--text-muted); }
		.now { background: var(--primary); color: var(--bg); border-radius: var(--radius); padding: 1px 2px; }
		.bad { color: var(--danger, #b00); text-decoration: underline; }
		.read { display: flex; gap: 14px; flex-wrap: wrap; }
	`;
	resolved?: Resolved;
	targetCpm = 200;
	stats: StatMap = {};
	engine?: ReturnType<typeof start>;
	// Where the learner is in the line, exposed as a reactive property so tests and callers can read it.
	cursor = 0;
	wrong = new Set<number>();
	// Speed of the last keystroke, which is the number that moves while typing.
	instantCpm = 0;

	updated(changed: Map<string, unknown>) {
		if (!this.engine && this.resolved) this.begin();
		else if (changed.has("resolved") && this.resolved) this.begin();
	}

	begin(): void {
		if (!this.resolved) return;
		this.engine = start(this.resolved, this.stats, this.targetCpm);
		this.cursor = 0;
		this.wrong = new Set();
		this.requestUpdate();
	}

	// Returns the key id to highlight, so the parent can drive the keyboard view from one event.
	key(typed: string, now: number): string | undefined {
		if (!this.engine || !this.resolved) return undefined;
		const before = this.cursor;
		const res = press(this.engine, this.resolved, typed, now, this.targetCpm);
		this.engine = res.engine;
		if (res.elapsedMs > 0) this.instantCpm = cpmFrom(res.elapsedMs);
		if (typed !== [...this.engine.text][before]) this.wrong.add(before);
		this.cursor = this.engine.index;
		this.requestUpdate();
		return res.targetId;
	}

	get done(): boolean {
		return !!this.engine && this.cursor >= [...this.engine.text].length;
	}

	/** Mean time per key across everything practised, from the stored samples. */
	get avgMs(): number {
		const ids = Object.keys(this.engine?.stats ?? {});
		if (!ids.length) return 0;
		const total = ids.reduce((s, id) => s + timeToTypeMs(this.engine!.stats[id]), 0);
		return Math.round(total / ids.length);
	}

	get sessionCpm(): number {
		return this.avgMs ? cpmFrom(this.avgMs) : 0;
	}

	override render() {
		const text = this.engine?.text ?? "";
		const chars = [...text];
		return html`
			<p class="line" aria-live="polite" data-text=${text}>${chars.map((c, i) => this.#cell(c, i))}</p>
			<div class="read">
				<span class="label">speed</span><span>${this.instantCpm} cpm</span>
				<span class="label">session</span><span>${this.sessionCpm} cpm</span>
				<span class="label">avg</span><span>${this.avgMs} ms/key</span>
				<span class="label">goal</span><span>${this.targetCpm} cpm</span>
			</div>
			${this.done ? html`<p class="done">Line done — keep going.</p>` : html``}
		`;
	}

	#cell(c: string, i: number) {
		if (i < this.cursor) return this.wrong.has(i) ? html`<span class="bad">${c}</span>` : html`<span>${c}</span>`;
		if (i === this.cursor) return html`<span class="now">${c}</span>`;
		return html`<span class="done">${c}</span>`;
	}
}

customElements.define("tt-practice", TtPractice);
