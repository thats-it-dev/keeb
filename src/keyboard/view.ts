import { LitElement, html, css, nothing, svg } from "https://kit.thatsit.app/lit.js";
import type { Resolved } from "./resolve.ts";
import type { RenderKey } from "./types.ts";

// Draws a resolved layout. Coordinates are already in 1/100 key units, so the SVG user unit is a hundredth.
export class TtKeyboard extends LitElement {
	static properties = { resolved: { type: Object }, active: { state: true }, missed: { state: true }, focusId: { state: true } };
	static styles = css`
		svg { display: block; width: 100%; height: auto; }
		.k rect { fill: var(--bg); stroke: var(--border-color); stroke-width: 2; rx: 8; }
		.k text { fill: var(--text-muted); font-size: 34px; text-anchor: middle; dominant-baseline: central; }
		.unt rect { fill: transparent; stroke-dasharray: 6 6; }
		.unt text { opacity: 0.4; }
		.on rect { fill: var(--primary); stroke: var(--primary); }
		.on text { fill: var(--bg); }
		.missed rect { fill: var(--accent); stroke: var(--accent); }
		/* The key the lesson is built around wears a broken ring of its own. A second element rather than a
		 * recoloured border, because this board already uses fill for "you just hit this" and red for "you
		 * missed", and a state that has to survive being drawn on top of both is a shape. */
		.ring { fill: none; stroke: var(--primary); stroke-width: 4; stroke-dasharray: 8 6; pointer-events: none; }
	`;
	resolved?: Resolved;
	active = "";
	missed = "";
	focusId = "";

	override render() {
		if (!this.resolved) return html``;
		const v = this.resolved.viewBox; // computed here, not in updated(): a private field set after the first
		// render never repaints, so the board loaded cropped to a 1x1 key until you touched a select.
		return html`<svg viewBox=${`${v.x} ${v.y} ${v.width} ${v.height}`} role="img" aria-label=${this.resolved.keys.length + " keys"}>
			${this.resolved.keys.map((k) => this.#key(k))}
		</svg>`;
	}

	#key(k: RenderKey) {
		const cls = ["k", k.rot ? "curved" : "", k.taught ? "" : "unt", k.id === this.active ? "on" : "", k.id === this.missed ? "missed" : ""]
			.filter(Boolean)
			.join(" ");
		const cx = k.x + k.w / 2;
		const cy = k.y + k.h / 2;
		const t = k.rot ? `rotate(${k.rot / 10} ${cx} ${cy})` : nothing; // an empty transform attribute makes the group unmeasurable
		const ring = k.id === this.focusId ? svg`<rect class="ring" x=${k.x + 5} y=${k.y + 5} width=${Math.max(0, k.w - 10)} height=${Math.max(0, k.h - 10)} rx="12"></rect>` : nothing;
		// Nested templates must use the svg tag: parsed on their own, <g>/<rect>/<text> land in the HTML
		// namespace and render nothing at all.
		return svg`<g class=${cls} data-id=${k.id} transform=${t}>
			<rect x=${k.x} y=${k.y} width=${k.w} height=${k.h}></rect>
			${ring}
			<text x=${cx} y=${cy}>${k.char === "" ? k.label : display(k.char)}</text>
		</g>`;
	}
}

export function display(char: string): string {
	if (char === " ") return "␣";
	if (char.length === 1) return char.toUpperCase();
	return char;
}

customElements.define("tt-keyboard", TtKeyboard);
