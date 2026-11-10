import { html, nothing } from "https://kit.thatsit.app/lit.js";
import type { DailyGoal } from "../stats/daily.ts";

/**
 * Today's minutes against the daily goal, on the practice screen itself — the question it answers is
 * "can I stop now?", which is asked while typing, not afterwards. A finished day says so in words; the
 * full bar is not allowed to be the only signal.
 */
export function dailyBar(d: DailyGoal) {
	if (d.goalMinutes <= 0) return nothing;
	return html`
		<div class="daily">
			<span class="label">today</span>
			<span class="track" role="progressbar" aria-label="practice today" aria-valuemin="0" aria-valuemax=${d.goalMinutes} aria-valuenow=${Math.min(d.minutes, d.goalMinutes)}><span class="kbar" style="width:${d.pct}%"></span></span>
			<span class="num">${d.minutes} / ${d.goalMinutes} min${d.reached ? " · goal reached" : ""}</span>
		</div>
	`;
}
