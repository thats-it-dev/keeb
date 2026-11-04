// The collapsible panel on the right of the history screen: its markup and styles only.
//
// It is closed by default and remembers that you opened it. The reason is the chart beside it: a panel full
// of prose competing with a line graph makes both of them worse, and these cards answer the question you ask
// *after* you have looked at the trend.
//
// The claims themselves come from panel.ts, which is pure, so every sentence here can be tested without
// mounting anything. Lit comes from the kit import map, like every other module in src/: importing it from
// npm would bundle a second copy, which test/build.test.ts checks for.

import { css, html, LitElement, nothing } from "https://kit.thatsit.app/lit.js";
import { sharedStyles } from "https://kit.thatsit.app/kit.js";
import type { PanelCard } from "./panel.ts";

const KEY = "keeb-panel-open";

/** How many claims the panel is making, which is what the badge counts. */
export function countItems(cards: PanelCard[]): number {
	return cards.reduce((n, c) => n + (c.rows?.length ?? 0) + (c.body ? 1 : 0), 0);
}

const cardHtml = (c: PanelCard) => html`
	<section class="card" data-id=${c.id}>
		<h3>${c.title}</h3>
		${c.stat ? html`<p class="big">${c.stat}<span class="sub">${c.sub ?? ""}</span></p>` : nothing}
		${c.body ? html`<p class="say">${c.body}</p>` : nothing}
		${(c.rows ?? []).map((r) => html`<p class="row"><b>${r.label}</b><span>${r.detail}</span></p>`)}
	</section>
`;

class InsightPanel extends LitElement {
	static styles = [
		sharedStyles,
		css`
			:host { display: block; width: 19rem; flex: 0 0 auto; align-self: start; }
			.insights { border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg); overflow: hidden; }
			.toggle { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; background: none; border: 0; color: var(--text); font: inherit; cursor: pointer; text-align: left; }
			.chev { display: inline-block; transition: transform 0.15s; color: var(--text-muted); }
			/* Presence, not ="1": a boolean Lit attribute reflects by adding or removing the attribute. */
			:host([data-open]) .chev { transform: rotate(90deg); }
			.t { flex: 1; font-weight: 600; }
			.n { font-size: 0.75rem; color: var(--text-muted); border: 1px solid var(--border-color); border-radius: 99px; padding: 1px 7px; }
			.body { display: none; border-top: 1px solid var(--border-color); }
			:host([data-open]) .body { display: block; }
			.card { padding: 12px; border-bottom: 1px solid var(--border-color); }
			.card:last-child { border-bottom: 0; }
			h3 { margin: 0 0 6px; font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
			.big { margin: 0; font-size: 1.4rem; font-weight: 700; }
			.big .sub { display: block; font-size: 0.75rem; font-weight: 400; color: var(--text-muted); }
			.say { margin: 6px 0 0; font-size: 0.85rem; line-height: 1.45; }
			.row { display: flex; justify-content: space-between; gap: 10px; margin: 4px 0 0; font-size: 0.85rem; }
			.row span { color: var(--text-muted); text-align: right; }
			.empty { margin: 0; padding: 12px; font-size: 0.85rem; color: var(--text-muted); }
		`,
	];

	// `open` is a public attribute rather than private state so that Lit, not this class, keeps the data-open
	// attribute in step with it: the stylesheet and the e2e checks both read that attribute, and an imperative
	// setAttribute from updated() would fight the reflector.
	static properties = {
		cards: { type: Array },
		open: { type: Boolean, attribute: "data-open", reflect: true },
	};

	cards: PanelCard[] = [];
	// Read from storage before first paint, so a reload does not show the panel animating itself open. The
	// attribute is presence-based, so the two representations have to be kept in step deliberately here.
	open = localStorage.getItem(KEY) === "1";

	render() {
		return html`
			<div class="insights">
				<button class="toggle" @click=${this.#toggle} aria-expanded=${this.open ? "true" : "false"}>
					<span class="chev">›</span><span class="t">Insights</span><span class="n">${countItems(this.cards)}</span>
				</button>
				<!-- inert, not merely hidden: a collapsed body must stay out of tab order and screen readers -->
				<div class="body" ?inert=${!this.open}>
					${this.cards.map(cardHtml)}
					${this.cards.length ? nothing : html`<p class="empty">Type a few sessions, and the panel fills itself.</p>`}
				</div>
			</div>
		`;
	}

	#toggle() {
		this.open = !this.open;
		localStorage.setItem(KEY, this.open ? "1" : "0"); // storage is a plain flag; the attribute stays presence-based
	}
}

customElements.define("tt-insight-panel", InsightPanel);

declare global {
	interface HTMLElementTagNameMap {
		"tt-insight-panel": InsightPanel;
	}
}
