// The insight pane: a full-height column on the right, the way an editor lays out a secondary sidebar.
//
// It is not a card. It has no rounded corners and no surrounding border — one rule on its left edge
// separates it from the content, and it owns the whole viewport height and its own scroll. Collapsed, it is
// a rail; open, a column. The layout and the mobile drawer follow kit's own tk-shell, so a keeb pane and a
// pi-web nav drawer behave the same way on the same screen.
//
// The claims inside it come from panel.ts, which is pure, so every sentence can be tested without mounting
// anything. Lit comes from the kit import map, like every other module in src/.

import { css, html, LitElement, nothing } from "https://kit.thatsit.app/lit.js";
import { sharedStyles } from "https://kit.thatsit.app/kit.js";
import type { PanelCard } from "./panel.ts";

/** The storage key the parent uses to remember the pane. Owned there, not here. */
export const PANEL_OPEN_KEY = "keeb-panel-open";
// Below 900px the pane becomes an off-canvas drawer. The number is written literally in the stylesheets that
// use it: a Lit css`...` placeholder is not allowed inside an @media condition, and interpolating one there
// yields invalid CSS whose rules can then apply at every width.

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
			:host {
				position: fixed;
				inset: 0 0 0 auto; /* the whole right edge, top to bottom */
				z-index: 30;
				display: flex;
				flex-direction: column;
				width: 2.25rem;
				box-sizing: border-box;
				background: var(--bg);
				border-left: 1px solid var(--line);
				transition: width 0.18s ease, transform 0.25s ease;
				padding-bottom: env(safe-area-inset-bottom);
			}
			:host([data-open]) { width: 19rem; }

			/* Closed: the rail IS the widget, so its parts sit in a vertical line. */
			.bar {
				display: flex;
				align-items: center;
				justify-content: center;
				gap: 8px;
				flex: 0 0 auto;
				width: 100%;
				padding: 12px 6px;
				background: none;
				border: 0;
				border-bottom: 1px solid var(--line);
				color: var(--text);
				font: inherit;
				font-size: 0.8rem;
				letter-spacing: 0.06em;
				text-transform: uppercase;
				text-align: left; /* kit resets buttons to centered text, which strands a pane title */
				cursor: pointer;
				writing-mode: vertical-rl;
			}
			/* Open: a header row, label left, count and collapse affordance right. */
			:host([data-open]) .bar { flex-direction: row; justify-content: flex-start; padding: 0 10px; height: 2.5rem; writing-mode: horizontal-tb; }
			.chev { color: var(--text-muted); flex: 0 0 auto; }
			:host([data-open]) .t { flex: 1 1 auto; font-weight: 600; }
			/* Open, the header reads like an editor's pane title: label at the left, the count and the collapse
			 * affordance out at the right edge. Closed, DOM order is already top to bottom. */
			:host([data-open]) .chev { order: 2; }
			:host([data-open]) .t { order: 0; }
			:host([data-open]) .n { order: 1; }
			.n {
				flex: 0 0 auto;
				font-size: 0.7rem;
				color: var(--text-muted);
				border: 1px solid var(--line);
				border-radius: 99px;
				padding: 0 6px;
				text-combine-upright: all; /* otherwise the digit lies on its side in the rail */
			}
			/* In vertical-rl a glyph is already turned 90deg clockwise, so 90deg here nets 180: the arrow
			 * points outward into the content, which is what a right-hand pane's affordance looks like. */
			:host(:not([data-open])) .chev { transform: rotate(90deg); }

			.body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
			:host(:not([data-open])) .body { display: none; }

			.card { padding: 14px 12px; border-bottom: 1px solid var(--line); }
			h3 { margin: 0 0 6px; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
			.big { margin: 0; font-size: 1.4rem; font-weight: 700; }
			.big .sub { display: block; font-size: 0.75rem; font-weight: 400; color: var(--text-muted); }
			.say { margin: 6px 0 0; font-size: 0.85rem; line-height: 1.45; }
			.row { display: flex; justify-content: space-between; gap: 10px; margin: 4px 0 0; font-size: 0.85rem; }
			.row span { color: var(--text-muted); text-align: right; }
			.empty { margin: 0; padding: 12px; font-size: 0.85rem; color: var(--text-muted); }

			/* Phone: a side menu. It leaves the layout entirely and slides in over the content, so nothing on
			 * the page is ever resized by it, with the same shadow and scrim the kit shell uses. */
			@media (max-width: 899px) {
				/* Off-canvas is not the same as gone: without visibility the closed drawer keeps its buttons in
				 * the tab order. The delay is what lets it stay painted while it slides back out. */
				:host {
					width: min(85vw, 20rem);
					transform: translateX(100%);
					box-shadow: -2px 0 12px var(--shadow-color);
					padding-top: env(safe-area-inset-top);
					visibility: hidden;
					transition: transform 0.25s ease, visibility 0s linear 0.25s;
				}
				:host([data-open]) { width: min(85vw, 20rem); transform: none; visibility: visible; transition: transform 0.25s ease, visibility 0s; }
				.bar { writing-mode: horizontal-tb; flex-direction: row; justify-content: flex-start; height: 2.5rem; padding: 0 10px; }
				.bar .chev { transform: none; order: 2; }
				:host(:not([data-open])) .chev { transform: rotate(180deg); }
				.t { flex: 1 1 auto; font-weight: 600; order: 0; }
				.n { order: 1; }
			}
		`,
	];

	// `open` is a public attribute rather than private state so Lit keeps data-open in step with it: the
	// stylesheet keys off that attribute, and setting it from updated() would fight the reflector.
	static properties = {
		cards: { type: Array },
		open: { type: Boolean, attribute: "data-open", reflect: true },
	};

	cards: PanelCard[] = [];
	open = false;

	render() {
		return html`
			<button class="bar" @click=${this.#toggle} aria-expanded=${this.open ? "true" : "false"} aria-label=${this.open ? "Collapse insights" : "Open insights"}>
				<span class="chev">›</span><span class="t">Insights</span><span class="n">${countItems(this.cards)}</span>
			</button>
			<!-- inert, not merely hidden: a closed pane's cards stay out of tab order and screen readers -->
			<div class="body" ?inert=${!this.open}>
				${this.cards.map(cardHtml)}
				${this.cards.length ? nothing : html`<p class="empty">Type a few sessions, and this fills itself.</p>`}
			</div>
		`;
	}

	#toggle() {
		// The parent owns the state and the storage key: it has to know which way the pane is folded, both to
		// reserve the width on a desktop and to draw the scrim on a phone.
		this.dispatchEvent(new CustomEvent("panel-toggle", { detail: !this.open, bubbles: true, composed: true }));
	}
}

customElements.define("tt-insight-panel", InsightPanel);

declare global {
	interface HTMLElementTagNameMap {
		"tt-insight-panel": InsightPanel;
	}
}
