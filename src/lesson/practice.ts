import { LitElement, html, css } from "https://kit.thatsit.app/lit.js";
import { press, start } from "../lesson/engine.ts";
import { cpmFrom, type StatMap } from "../stats/stats.ts";
import { charForLayer } from "../keyboard/layer.ts";
import type { Resolved } from "../keyboard/resolve.ts";
import type { LayerKey } from "../keyboard/types.ts";

// The typing pane. It owns the lesson engine and reports every keystroke back up, so the keyboard
// view can highlight the key and the store can persist it.
export class TtPractice extends LitElement {
	static properties = { resolved: { type: Object }, targetCpm: { type: Number }, stats: { type: Object }, keyboardOrder: { type: Boolean }, realWords: { type: Boolean }, cursor: { state: true } };
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
		.badnow { color: var(--accent); text-decoration: underline; text-decoration-color: var(--primary); text-decoration-thickness: 2px; text-underline-offset: 5px; } /* mistyped target: red + underline so cursor never vanishes */
		:host { display: block; }
	`;
	resolved?: Resolved;
	targetCpm = 200;
	stats: StatMap = {};
	// The two curriculum switches. They change which letters are in play, so a change restarts the line.
	keyboardOrder = false;
	realWords = false;
	engine?: ReturnType<typeof start>;
	// Where the learner is in the line, exposed as a reactive property so tests and callers can read it.
	cursor = 0;
	wrong = new Set<number>();
	// Speed of the last keystroke, which is the number that moves while typing.
	instantCpm = 0;

	updated(changed: Map<string, unknown>) {
		const restart = changed.has("resolved") || changed.has("keyboardOrder") || changed.has("realWords");
		if (!this.engine || (restart && this.resolved)) this.begin();
	}

	begin(): void {
		if (!this.resolved) return;
		this.engine = start(this.#course, this.stats);
		this.cursor = 0;
		this.wrong = new Set();
		this.requestUpdate();
	}

	// The engine and the screens above it read the curriculum through this one object, so a line can never
	// be built by rules the display is showing something else.
	get #course() {
		return { resolved: this.resolved!, targetCpm: this.targetCpm, keyboardOrder: this.keyboardOrder, realWords: this.realWords };
	}

	/** The key this line is built around, for the board and the readout. Not `focus`: HTMLElement already
	 *  owns that name for moving the DOM focus. */
	get focusId(): string | undefined {
		return this.engine?.ladder.focus;
	}

	/** Active layer index — forwarded to the keyboard view. */
	get layer(): number {
		return this.engine?.layer ?? 0;
	}

	/** Hint key id: if the target character is not on the active layer, return the layer-switch key
	 *  that gets back to it (usually a `&trans` entry pointing to layer 0). */
	get hintId(): string {
		const e = this.engine;
		const r = this.resolved;
		if (!e || !r) return "";
		const targetChar = [...e.text][e.index] ?? "";
		if (!targetChar) return "";
		const targetLower = targetChar.toLowerCase();
		// Check if the target char is on the active layer.
		if (r.layers?.[e.layer]) {
			const layerChars = r.layers[e.layer].map((c) => c.toLowerCase());
			if (layerChars.includes(targetLower)) return "";
		}
		// Find a &trans key on the active layer (toLayer:0) — must actually be transparent:
		// the active layer must NOT override the base char at that position.
		const layerKeys = r.layerKeys ?? [];
		for (const lk of layerKeys) {
			if (lk.toLayer !== 0) continue;
			const gk = r.byId.get(lk.keyId);
			if (!gk) continue;
			const idx = r.keys.findIndex((k) => k.id === lk.keyId);
			if (idx < 0) continue;
			if (charForLayer(r, idx, e.layer) !== r.keys[idx].char) continue;
			return gk.id;
		}
		// Fallback: scan layerKeys for any switch pointing to a layer that has the char.
		for (const lk of layerKeys) {
			if (lk.toLayer === 0) continue; // &trans handled above
			if (r.layers?.[lk.toLayer]) {
				const layerChars = r.layers[lk.toLayer].map((c) => c.toLowerCase());
				if (layerChars.includes(targetLower)) {
					const gk = r.byId.get(lk.keyId);
					if (gk) return gk.id;
				}
			}
		}
		return "";
	}

	// Returns the key id to highlight, so the parent can drive the keyboard view from one event.
	key(typed: string, now: number): string | undefined {
		if (!this.engine || !this.resolved) return undefined;
		const before = this.cursor;
		const expected = [...this.engine.text][before] ?? "";
		const res = press(this.#course, this.engine, typed, now);
		this.engine = res.engine;
		if (res.elapsedMs > 0) this.instantCpm = cpmFrom(res.elapsedMs);
		if (res.accepted && res.targetId === "") {
			// Space or Enter started a new line: its marks start clean.
			this.wrong = new Set();
		} else if (res.finished) {
			// The finished line stays on screen: red marks and the cursor are preserved until advance.
		} else if (this.engine.pending !== "" && typed !== "Enter" && typed !== expected && before < [...this.engine.text].length) {
			this.wrong.add(before);
		}
		if (!res.finished) this.cursor = this.engine.index;
		this.requestUpdate();
		return res.pressedId || undefined;
	}

	override render() {
		const text = this.engine?.text ?? "";
		return html`
			<p class="line" aria-live="polite" data-text=${text}>${this.#runs(text)}</p>
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

	#state(i: number): "now" | "hit" | "bad" | "badnow" | "todo" {
		if (this.wrong.has(i) && i === this.cursor) return "badnow";
		if (this.wrong.has(i)) return "bad";
		if (i === this.cursor) return "now";
		return i < this.cursor ? "hit" : "todo";
	}
}

customElements.define("tt-practice", TtPractice);
