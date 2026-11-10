import { html, nothing } from "https://kit.thatsit.app/lit.js";
import type { PanelCard } from "../stats/panel.ts";

/** How many claims the panel is making, which is what the header's badge counts. */
export function countItems(cards: PanelCard[]): number {
	return cards.reduce((n, c) => n + (c.rows?.length ?? 0) + (c.body ? 1 : 0), 0);
}

/** The insight cards, in the panel's priority order, as children of the shell's aside section. */
export function insightCards(cards: PanelCard[]) {
	return html`
		${cards.map((c) => html`
			<section class="card" data-id=${c.id}>
				<h3>${c.title}</h3>
				${c.stat ? html`<p class="big">${c.stat}<span class="sub">${c.sub ?? ""}</span></p>` : nothing}
				${c.body ? html`<p class="say">${c.body}</p>` : nothing}
				${(c.rows ?? []).map((r) => html`<p class="row"><b>${r.label}</b><span>${r.detail}</span></p>`)}
			</section>`)}
		${cards.length ? nothing : html`<p class="empty">Type a few sessions, and this fills itself.</p>`}
	`;
}
