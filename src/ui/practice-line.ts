import { html, nothing } from "https://kit.thatsit.app/lit.js";
import { FINGER_NAME, type Geometry } from "../keyboard/types.ts";
import type { Resolved } from "../keyboard/resolve.ts";

/**
 * The three lines under the heading: the numbers above the practice line, the board note, and what the
 * last keystroke was. They read from state the page already keeps, so they are right on the first paint
 * after a reload, before a single key is pressed.
 */
export function readout(nowWpm: number, avgWpm: number, goalWpm: number) {
	const cell = (label: string, value: string) => html`<div class="metric"><span class="label">${label}</span><b>${value}</b></div>`;
	return html`
		<div class="read">
			${cell("now", `${nowWpm} wpm`)} ${cell("avg", `${avgWpm} wpm`)} ${cell("goal", `${goalWpm} wpm`)}
		</div>
	`;
}

// Imported boards are the user's own data, so they get a different note than our reconstructions.
export function boardNotice(geo: Geometry) {
	if (geo.id.startsWith("import:")) return html`<p class="warn row">Positions came from ${geo.source}. Compare the drawing with your board before trusting it.</p>`;
	return geo.verified ? nothing : html`<p class="warn row">Positions for ${geo.name} are our reconstruction, not the vendor's file.</p>`;
}

export function lastKey(r: Resolved, lastId: string) {
	const key = r.byId.get(lastId);
	if (!key) return html`<span class="label">keys</span> ${r.keys.length} mapped`;
	return html`<span class="label">last</span> <span class="hit">${key.char}</span> · ${key.id} · ${FINGER_NAME[key.finger]}`;
}
