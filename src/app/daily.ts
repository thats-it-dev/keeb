import { saveDaily, loadDaily } from "../data/store.ts";
import { foldDaily, type DailyRow } from "../stats/daily.ts";

// The goal in minutes, per browser — the same kind of slot the layout selection lives in. It is not
// per-layout settings because the tally it measures is device-wide: a board switch would reset the goal
// against unchanged minutes. 0 means "no goal" and hides the bar.
const STORE = "keeb:dailyGoalMin";
const DEFAULT_GOAL_MIN = 15;

/** Today's minutes, counted on this device. The rows live here and the page owns the repaint, because
 *  both writers — a closing session and a reload — resolve after the render that asked for them. */
export class DailyTally {
	rows: DailyRow[] = [];

	constructor(readonly repaint: () => void) {}

	/** The first read. Like the history store it must never be why the lesson cannot start. */
	load(): void {
		void loadDaily()
			.then((rows) => {
				this.rows = rows;
				this.repaint();
			})
			.catch(() => undefined);
	}

	/** Charge one finished session: fold first, so the screen is right even when the tab dies before
	 *  the write lands, then persist exactly what the page is showing. */
	record(ms: number): void {
		this.rows = foldDaily(this.rows, Date.now(), ms);
		this.repaint();
		void saveDaily(this.rows).catch(() => undefined);
	}
}

/** The stored goal, or the shipped default. Junk and absence both answer with 15, not with a hidden bar. */
export function savedDailyGoalMin(): number {
	const raw = localStorage.getItem(STORE);
	if (raw === null) return DEFAULT_GOAL_MIN;
	const min = Number(raw);
	return Number.isInteger(min) && min >= 0 && min <= 240 ? min : DEFAULT_GOAL_MIN;
}

/** Write a new goal and return it, or return nothing when the number is out of range. */
export function setDailyGoalMin(value: number): number | undefined {
	const min = Math.round(value);
	if (!Number.isInteger(min) || min < 0 || min > 240) return undefined;
	localStorage.setItem(STORE, String(min));
	return min;
}
