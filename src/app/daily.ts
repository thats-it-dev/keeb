import { addDaily, DEFAULT_SETTINGS, layoutKey, loadDaily, saveSettings, type Settings } from "../data/store.ts";
import type { DailyRow } from "../stats/daily.ts";

/**
 * Today's minutes, counted on this device. The rows live here and the page owns the repaint, because
 * both writers — a closing session and a reload — resolve after the render that asked for them.
 */
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

	/** Charge one finished session to today, and show the new tally when the write lands. */
	record(ms: number): void {
		void addDaily(Date.now(), ms)
			.then((rows) => {
				this.rows = rows;
				this.repaint();
			})
			.catch(() => undefined);
	}
}

/** The daily goal as this device knows it. A stored row from before the bar existed keeps the shipped default. */
export const dailyGoalMin = (s: Settings): number => s.dailyGoalMin ?? DEFAULT_SETTINGS.dailyGoalMin ?? 0;

/** The settings input as new settings, or nothing when the number is out of range. */
export function setDailyGoalMin(value: number, s: Settings): Settings | undefined {
	const min = Math.round(value);
	if (!Number.isFinite(min) || min < 5 || min > 240) return undefined;
	const next = { ...s, dailyGoalMin: min };
	void saveSettings(layoutKey(next.geometry, next.keymap), next);
	return next;
}
