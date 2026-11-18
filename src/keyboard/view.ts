import { LitElement, html, css, nothing, svg } from "https://kit.thatsit.app/lit.js";
import type { Resolved } from "./resolve.ts";
import type { RouteView } from "./routes.ts";
import type { RenderKey } from "./types.ts";

// Draws a resolved layout. Coordinates are already in 1/100 key units, so the SVG user unit is a hundredth.
export class TtKeyboard extends LitElement {
	static properties = { resolved: { type: Object }, active: { state: true }, missed: { state: true }, focusId: { state: true }, route: { type: Object } };
	static styles = css`
		svg { display: block; width: 100%; height: auto; }
		.k rect { fill: var(--bg); stroke: var(--border-color); stroke-width: 2; rx: 8; }
		.k text { fill: var(--text-muted); font-size: 34px; text-anchor: middle; dominant-baseline: central; }
		.unt rect { fill: transparent; stroke-dasharray: 6 6; }
		.unt text { opacity: 0.4; }
		.on rect { fill: var(--primary); stroke: var(--primary); }
		.on text { fill: var(--bg); }
		.missed rect { fill: var(--accent); stroke: var(--accent); }
		/* The route -- what the lesson is asking for next. On a layered board only, so a built-in keymap
		 * keeps drawing exactly the markup it drew before: the struck key stays the only filled one. */
		.route rect { stroke: var(--primary); stroke-width: 4; }
		.route.ly1 rect { stroke: var(--chart-2); }
		.route.ly2 rect { stroke: var(--chart-3); }
		.route.ly3 rect { stroke: var(--chart-4); }
		.route.lyx rect { stroke: var(--text-secondary); }
		.route .g:not(.gok) { opacity: 0.5; }
		/* The key the lesson is built around wears a broken ring of its own. A second element rather than a
		 * recoloured border, because this board already uses fill for "you just hit this" and red for "you
		 * missed", and a state that has to survive being drawn on top of both is a shape. */
		.ring { fill: none; stroke: var(--primary); stroke-width: 4; stroke-dasharray: 8 6; pointer-events: none; }
		/* Layered keycaps: layer characters in corner slots at keycap-caption size, each in its layer's
		 * colour; the route's own character at full size and weight; siblings dimmed out of its way. */
		.g.ly1 { fill: var(--chart-2); }
		.g.ly2 { fill: var(--chart-3); }
		.g.ly3 { fill: var(--chart-4); }
		.g.lyx { fill: var(--text-secondary); }
		.sl { font-size: 20px; }
		.gok { font-size: 40px; }
		.on .g.gok, .missed .g.gok { fill: var(--bg); }
		.on .g:not(.gok), .missed .g:not(.gok) { opacity: 0.35; }
		.routering { fill: none; stroke-width: 4; stroke-dasharray: 4 5; pointer-events: none; }
		.routering.ly1 { stroke: var(--chart-2); }
		.routering.ly2 { stroke: var(--chart-3); }
		.routering.lyx { stroke: var(--text-secondary); }
		/* The layer legend under a layered board: state is never carried by colour alone -- every swatch
		 * wears its layer's name. */
		.legend { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; align-items: baseline; font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; }
		.legend .entry { display: inline-flex; gap: 5px; align-items: baseline; }
		.legend .sw { width: 10px; height: 10px; border-radius: 3px; align-self: center; }
		.legend .ly0 { background: var(--primary); }
		.legend .ly1 { background: var(--chart-2); }
		.legend .ly2 { background: var(--chart-3); }
		.legend .ly3 { background: var(--chart-4); }
		.legend .lyx { background: var(--text-secondary); }
	`;
	resolved?: Resolved;
	active = "";
	missed = "";
	focusId = "";
	route?: RouteView;

	override render() {
		if (!this.resolved) return html``;
		const v = this.resolved.viewBox; // computed here, not in updated(): a private field set after the first
		// render never repaints, so the board loaded cropped to a 1x1 key until you touched a select.
		return html`<svg viewBox=${`${v.x} ${v.y} ${v.width} ${v.height}`} role="img" aria-label=${this.resolved.keys.length + " keys"}>
			${this.resolved.keys.map((k) => this.#key(k))}
		</svg>${this.#legend()}`;
	}

	// Which colour means which layer. Only a board with real layers earns a row under the keycaps; a
	// built-in board renders the single svg element it always rendered, byte for byte.
	#legend() {
		const names = this.resolved?.layerNames ?? [];
		if (!names.some((n) => n)) return nothing;
		const entries = names.map((name, i) => {
			if (!name) return nothing;
			const cls = i <= 3 ? String(i) : "x";
			return html`<span class="entry"><i class=${`sw ly${cls}`}></i><span class="name">${name}</span></span>`;
		});
		return html`<div class="legend" aria-label="keyboard layers">${entries}</div>`;
	}

	#key(k: RenderKey) {
		// A built-in board never draws a route: same markup as before layers existed. A layered one lights
		// the route in the outline lane, leaving the FILL lane to what just happened (struck, missed).
		const hasLayers = (this.resolved?.layerNames.length ?? 0) > 0;
		const isRoute = hasLayers && this.route !== undefined && this.route.keyId === k.id;
		const cls = ["k", k.rot ? "curved" : "", k.taught ? "" : "unt", k.id === this.active ? "on" : "", k.id === this.missed ? "missed" : "", isRoute ? "route" : "", isRoute && this.route!.layer > 0 ? `ly${ly(this.route!.layer)}` : ""]
			.filter(Boolean)
			.join(" ");
		const cx = k.x + k.w / 2;
		const cy = k.y + k.h / 2;
		const t = k.rot ? `rotate(${k.rot / 10} ${cx} ${cy})` : nothing; // an empty transform attribute makes the group unmeasurable
		const ring = k.id === this.focusId ? svg`<rect class="ring" x=${k.x + 5} y=${k.y + 5} width=${Math.max(0, k.w - 10)} height=${Math.max(0, k.h - 10)} rx="12"></rect>` : nothing;
		const route = this.route;
		const wayThere = route && route.layer > 0 && route.ringId === k.id && k.id !== this.focusId ? svg`<rect class="routering ly${ly(route.layer)}" x=${k.x + 5} y=${k.y + 5} width=${Math.max(0, k.w - 10)} height=${Math.max(0, k.h - 10)} rx="12"></rect>` : nothing;
		// A key whose only character is its base one -- every key on a built-in board, and most keys on a
		// layered one -- renders exactly the markup it rendered before layers existed. The corner-slot
		// renderer only wakes up for keycaps that earned a second face.
		const multi = k.glyphs.some((g) => g.layer > 0);
		// Nested templates must use the svg tag: parsed on their own, <g>/<rect>/<text> land in the HTML
		// namespace and render nothing at all.
		return svg`<g class=${cls} data-id=${k.id} transform=${t}>
			<rect x=${k.x} y=${k.y} width=${k.w} height=${k.h}></rect>
			${ring}
			${wayThere}
			${multi ? this.#glyphs(k, cx, cy) : svg`<text x=${cx} y=${cy}>${k.char === "" ? k.label : display(k.char)}</text>`}
		</g>`;
	}

	// The base character holds the centre at reading size; layer characters take corner slots (top-left,
	// top-right, bottom-left, in layer order) at keycap-caption size, each in its layer's colour.
	#glyphs(k: RenderKey, cx: number, cy: number) {
		const slots = [
			[k.x + 17, k.y + 19],
			[k.x + k.w - 17, k.y + 19],
			[k.x + 17, k.y + k.h - 19],
		];
		const parts: ReturnType<typeof svg>[] = [];
		if (!k.glyphs.some((g) => g.layer === 0)) parts.push(svg`<text x=${cx} y=${cy}>${k.char === "" ? k.label : display(k.char)}</text>`);
		let corner = 0;
		for (const g of k.glyphs) {
			const gok = (this.resolved?.layerNames.length ?? 0) > 0 && this.route?.keyId === k.id && this.route.char === g.char ? " gok" : "";
			if (g.layer === 0) {
				parts.push(svg`<text class=${`g${gok}`} x=${cx} y=${cy}>${display(g.char)}</text>`);
				continue;
			}
			const [sx, sy] = slots[Math.min(corner++, slots.length - 1)]!;
			parts.push(svg`<text class=${`g sl ly${ly(g.layer)}${gok}`} x=${sx} y=${sy}>${display(g.char)}</text>`);
		}
		return svg`${parts}`;
	}
}

// ly1..ly3 are the three layer colours; a fourth layer and beyond share a neutral tone. --chart-1 is
// skipped on purpose: the lit key is already --primary, and two ambers would compete for "this one".
function ly(layer: number): number | "x" {
	return layer <= 3 ? layer : "x";
}

export function display(char: string): string {
	if (char === " ") return "␣";
	if (char.length === 1) return char.toUpperCase();
	return char;
}

customElements.define("tt-keyboard", TtKeyboard);
