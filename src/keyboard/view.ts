import { LitElement, html, css, nothing, type PropertyValues } from "https://kit.thatsit.app/lit.js";
import type { Resolved } from "./resolve.ts";
import type { RenderKey } from "./types.ts";

// Draws a resolved layout. Coordinates are already in 1/100 key units, so the SVG user unit is a hundredth.
export class TtKeyboard extends LitElement {
	static properties = { resolved: { type: Object }, active: { state: true }, missed: { state: true } };
	static styles = css`
		svg { display: block; width: 100%; height: auto; }
		.k rect { fill: var(--bg); stroke: var(--border-color); stroke-width: 2; rx: 8; }
		.k text { fill: var(--text-muted); font-size: 34px; text-anchor: middle; dominant-baseline: central; }
		.extra rect { fill: transparent; stroke-dasharray: 6 6; }
		.on rect { fill: var(--primary); stroke: var(--primary); }
		.on text { fill: var(--bg); }
		.missed rect { fill: var(--danger, #c00); stroke: var(--danger, #c00); }
	`;
	resolved?: Resolved;
	active = "";
	missed = "";
	#box = "0 0 100 100";

	// Lit only re-renders on identity change, so keep the viewBox in sync with the object we were given.
	updated(changed: PropertyValues) {
		if (changed.has("resolved") && this.resolved) {
			const v = this.resolved.viewBox;
			this.#box = `${v.x} ${v.y} ${v.width} ${v.height}`;
		}
	}

	override render() {
		if (!this.resolved) return html``;
		return html`<svg viewBox=${this.#box} role="img" aria-label=${this.resolved.keys.length + " keys"}>
			${this.resolved.keys.map((k) => this.#key(k))}
		</svg>`;
	}

	#key(k: RenderKey) {
		const cls = ["k", k.rot ? "curved" : "", k.char === "" ? "extra" : "", k.id === this.active ? "on" : "", k.id === this.missed ? "missed" : ""]
			.filter(Boolean)
			.join(" ");
		const cx = k.x + k.w / 2;
		const cy = k.y + k.h / 2;
		const t = k.rot ? `rotate(${k.rot / 10} ${cx} ${cy})` : nothing; // an empty transform attribute makes the group unmeasurable
		return html`<g class=${cls} data-id=${k.id} transform=${t}>
			<rect x=${k.x} y=${k.y} width=${k.w} height=${k.h}></rect>
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
