import { html } from "https://kit.thatsit.app/lit.js";

// The one card template, so the key stats and the history cannot render the same kind of number two ways.
export function card(label: string, value: string) {
	return html`<div class="card"><span class="label">${label}</span><b>${value}</b></div>`;
}
