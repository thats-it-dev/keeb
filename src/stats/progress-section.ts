import { html, nothing } from "https://kit.thatsit.app/lit.js";
import { wpm, type Overview } from "./overview.ts";
import { card } from "../ui/card.ts";

export function progressSection(o: Overview, goalMs: number) {
	const chips = (list: Overview["keys"]) => html`<span class="chips">${list.map((k) => html`<span class="chip" title="no samples yet">${k.label}</span>`)}</span>`;
	// "waiting" is every key with no samples, unlocked or not; the locked ones are the rest.
	const stillLocked = o.waiting.filter((k) => !o.untried.some((u) => u.id === k.id));
	// History is its own section, outside the keys branch. It comes from synced sessions, and a browser
	// that has typed nothing local can still hold a year of practice on its repo -- gating the chart on
	// local per-key stats hid exactly the person who most wants to see it.
	const keys = o.covered
		? html`
				<div class="grid">
					${card("average", `${o.avgWpm} wpm`)} ${card("at goal", `${o.readyPct}%`)} ${card("errors", `${o.errPct}%`)} ${card("keys", `${o.covered}/${o.total}`)}
					${card("hands", `${o.handBalance}/${100 - o.handBalance}`)}
				</div>
				${o.focusLabel
					? html`<p class="empty" data-focus=${o.focusLabel}>Every word on screen uses <b>${o.focusLabel}</b> — it is the letter of yours that has never held the goal speed.</p>`
					: html`<p class="empty">${o.slowest.length ? `Slowest: ${o.slowest.map((k) => k.label).join(", ")}. Nothing there is below goal, so the next letter is unlocked.` : ""}</p>`}
				<tk-bars .data=${o.measured.map((k) => ({ key: k.label, ms: k.ms }))} label="key" value="ms" .goal=${goalMs} unit="ms" .format=${(ms: number) => `${ms} ms · ${wpm(ms)} wpm`}></tk-bars>
				${o.untried.length ? html`<p class="empty">Unlocked but never practised ${chips(o.untried)}</p>` : nothing}
				${stillLocked.length ? html`<p class="empty">Still locked ${chips(stillLocked)}</p>` : nothing}
			`
		: html`<p class="empty">A key gets a bar once you have hit it correctly. Hit the highlighted letter to start.</p>`;
	return html`
		<section class="stats">
			<h3>progress</h3>
			${keys}
		</section>
	`;
}
