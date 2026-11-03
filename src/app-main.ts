import { LitElement, html, css } from "https://kit.thatsit.app/lit.js";
import { sharedStyles } from "https://kit.thatsit.app/kit.js";

// M0: the shell only. M1 replaces this render with the keyboard view, M2 with the lesson engine.
export class AppMain extends LitElement {
	static styles = [
		sharedStyles,
		css`
			main { display: grid; gap: 14px; padding: 18px; max-width: 44rem; margin: 0 auto; }
			.row { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
		`,
	];

	render() {
		return html`
			<main>
				<h1>${__APP_TITLE__}</h1>
				<p class="row"><span class="label">status</span> Nothing to train yet — the keyboard view lands in M1.</p>
				<p class="row"><span class="label">plan</span> Split geometries (Go60, Corne, Lily58), a ZMK keymap importer, progress stored on your own atproto PDS.</p>
			</main>
		`;
	}
}
customElements.define("app-main", AppMain);
