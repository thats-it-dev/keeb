// The collapsible panel on the right of the history screen: its markup and styles only.
//
// It is closed by default, collapses sideways to a rail, and remembers that you opened it. The reason is the
// chart beside it: a panel full of prose competing with a line graph makes both of them worse, and these
// cards answer the question you ask *after* you have looked at the trend.
//
// The claims themselves come from panel.ts, which is pure, so every sentence here can be tested without
// mounting anything. Lit comes from the kit import map, like every other module in src/: importing it from
// npm would bundle a second copy, which test/build.test.ts checks for.

import { css, html, LitElement, nothing } from "https://kit.thatsit.app/lit.js";
import { sharedStyles } from "https://kit.thatsit.app/kit.js";
import type { PanelCard } from "./panel.ts";

/** The storage key the parent uses to remember the pane. Owned there, not here. */
export const PANEL_OPEN_KEY = "keeb-panel-open";

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
			/* Collapses sideways, like the sidebar of a code editor: the rail is the whole widget when shut, and
			 * opening it takes width from the chart rather than pushing the page taller. */
			:host { display: block; width: 2.25rem; flex: 0 0 auto; align-self: stretch; transition: width 0.18s ease; }
			:host([data-open]) { width: 19rem; }
			.insights { display: flex; flex-direction: column; height: 100%; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg); overflow: hidden; }
			/* Closed, the toggle IS the panel: a rail of vertical text that fills the section's height, the way
			 * an editor's sidebar tab does. It must not be given a width of its own -- in a column layout the
			 * cross axis is already the panel's width, and 100% there squeezes the body out of the row. */
			.toggle { display: flex; align-items: center; justify-content: center; gap: 8px; flex: 1 1 auto; padding: 10px 4px; background: none; border: 0; color: var(--text); font: inherit; cursor: pointer; writing-mode: vertical-rl; }
			.chev { display: inline-block; transition: transform 0.15s; color: var(--text-muted); }
			/* Presence, not ="1": a boolean Lit attribute reflects by adding or removing the attribute. */
			:host([data-open]) .toggle { flex: 0 0 auto; justify-content: flex-start; padding: 10px 12px; writing-mode: horizontal-tb; border-bottom: 1px solid var(--border-color); }
			/* In vertical-rl a glyph is already turned 90deg clockwise, so a chevron pointing right comes out
			 * pointing DOWN, and an added 180deg would point it UP. 90deg here nets 180deg total: the arrow reads
			 * as pointing outward into the content, which is the affordance a right-hand sidebar uses. */
			:host(:not([data-open])) .chev { transform: rotate(90deg); }
			/* The count is a digit, and digits in vertical text lie on their side. This keeps it upright. */
			.n { text-combine-upright: all; }
			.t { font-weight: 600; }
			/* In the rail the three parts sit together in the middle; open, the label takes the slack so the
			 * badge is pushed to the right edge like any other header row. */
			:host([data-open]) .t { flex: 1; }
			.n { flex: 0 0 auto; font-size: 0.75rem; color: var(--text-muted); border: 1px solid var(--border-color); border-radius: 99px; padding: 1px 7px; }
			/* display:none while shut: the rail is 2.25rem wide, and reflowing the cards into that column to
			 * fade them out would cost a layout pass on every frame of the transition. */
			.body { display: none; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
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
			/* A vertical rail in a single-column layout is just a tall bar: on a phone the panel goes full width
			 * and the header lies back down. */
			@media (max-width: 46rem) {
				:host, :host([data-open]) { width: 100%; }
				.toggle { flex: 0 0 auto; justify-content: flex-start; padding: 10px 12px; writing-mode: horizontal-tb; border-bottom: 1px solid var(--border-color); }
				:host(:not([data-open])) .chev { transform: rotate(90deg); }
			}
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
	open = false;

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
		// The parent owns the state and the storage key. This component only reports the click: the history
		// section has to know whether the pane is open to reserve width for it, and a child keeping that fact to
		// itself is how a panel ends up overlapping the chart it was supposed to squeeze.
		this.dispatchEvent(new CustomEvent("panel-toggle", { detail: !this.open, bubbles: true, composed: true }));
	}
}

customElements.define("tt-insight-panel", InsightPanel);

declare global {
	interface HTMLElementTagNameMap {
		"tt-insight-panel": InsightPanel;
	}
}
