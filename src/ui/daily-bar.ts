import { html, nothing } from "https://kit.thatsit.app/lit.js";
import type { DailyGoal } from "../stats/daily.ts";

/**
 * Today's minutes against the daily goal, on the practice screen itself — the question it answers is
 * "can I stop now?", which is asked while typing, not afterwards. A finished day says so in words via
 * the readout; the full bar is not allowed to be the only signal.
 */
export function dailyBar(d: DailyGoal) {
	if (d.goalMinutes <= 0) return nothing;
	return html`
		<div class="daily">
			<tk-bars .data=${[{ today: "today", min: d.minutes }]} label="today" value="min" .goal=${d.goalMinutes} unit="min"></tk-bars>
		</div>
	`;
}
