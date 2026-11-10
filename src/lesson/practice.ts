import { LitElement, html, css } from "https://kit.thatsit.app/lit.js";
import { press, start } from "../lesson/engine.ts";
import { cpmFrom, type StatMap } from "../stats/stats.ts";
import type { Resolved } from "../keyboard/resolve.ts";

// The typing pane. It owns the lesson engine and reports every keystroke back up, so the keyboard
// view can highlight the key and the store can persist it.
export class TtPractice extends LitElement {
	static properties = { resolved: { type: Object }, targetCpm: { type: Number }, stats: { type: Object }, cursor: { state: true } };
	static styles = css`
		/* keybr-style line: plain text, no box, no caret. Colour carries what is typed, wrong, next. */
		.line { font-size: 1.5rem; line-height: 2.4; margin: 0; overflow-wrap: break-word; text-align: center; }
		.hit { color: var(--text-primary); } /* completed: darkest grey, behind the cursor */
		.todo { color: var(--text-muted); } /* upcoming */
		.bad { color: var(--accent); } /* mistyped: red, and it outranks the cursor colour */
		/* The letter to type next keeps the colour of every letter you have NOT typed yet, and carries an
		 * underline instead. Colour is reserved for what happened: dark means you hit it, red means you did
		 * not. A coloured target sits one step ahead of the letters you have hit and reads as the line
		 * running away from your fingers. The underline costs no layout, so nothing shifts sideways as it
		 * moves (the reason the old padded-chip version went). */
		.now { color: var(--text-muted); text-decoration: underline; text-decoration-color: var(--primary); text-decoration-thickness: 2px; text-underline-offset: 5px; }
		:host { display: block; }
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
		// Compare against the line that was on screen: after press() this.engine.text is the *next* run.
		const expected = [...this.engine.text][before] ?? "";
		const res = press(this.engine, this.resolved, typed, now, this.targetCpm);
		this.engine = res.engine;
		if (res.elapsedMs > 0) this.instantCpm = cpmFrom(res.elapsedMs);
		// Marks belong to a line. When a run ends the line is replaced, so its colours go with it;
		// a mistype inside the current line stays red where it happened.
		if (res.finished) this.wrong = new Set();
		else if (typed !== expected) this.wrong.add(before);
		this.cursor = this.engine.index;
		this.requestUpdate();
		return res.pressedId || undefined;
	}

	get done(): boolean {
		return !!this.engine && this.cursor >= [...this.engine.text].length;
	}

	override render() {
		const text = this.engine?.text ?? "";
		return html`
			<p class="line" aria-live="polite" data-text=${text}>${this.#runs(text)}</p>
			${this.done ? html`<p class="todo">Line done — keep going.</p>` : html``}
		`;
	}

	// One span per character would disable kerning and shaping at every span boundary, which is what
	// made the line look badly spaced. Group adjacent characters that share a state instead.
	#runs(text: string) {
		const chars = [...text];
		const out: ReturnType<typeof html>[] = [];
		for (let i = 0; i < chars.length; ) {
			const state = this.#state(i);
			let j = i + 1;
			if (state !== "now") while (j < chars.length && this.#state(j) === state) j += 1;
			out.push(html`<span class=${state}>${chars.slice(i, j).join("")}</span>`);
			i = j;
		}
		return out;
	}

	#state(i: number): "now" | "hit" | "bad" | "todo" {
		if (this.wrong.has(i)) return "bad";
		if (i === this.cursor) return "now";
		return i < this.cursor ? "hit" : "todo";
	}
}

customElements.define("tt-practice", TtPractice);
