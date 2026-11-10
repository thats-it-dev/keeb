import { describe, expect, it } from "vitest";
import { dailyGoal, foldDaily, KEEP_DAYS, todayMs, type DailyRow } from "../src/stats/daily.ts";
import { dayKey } from "../src/stats/history.ts";

// Local noon N CALENDAR days ago, for the same reason history.test.ts gives: a DST week makes an
// 86,400,000-ms subtraction land a day off, and dayKey() walks the calendar.
const noon = (daysAgo: number) => {
	const d = new Date();
	d.setDate(d.getDate() - daysAgo);
	d.setHours(12, 0, 0, 0);
	return d.getTime();
};
const row = (daysAgo: number, minutes: number): DailyRow => ({ day: dayKey(noon(daysAgo)), ms: minutes * 60_000 });
const TODAY = noon(0);

describe("todayMs", () => {
	it("counts today only, and sums two rows that share a day", () => {
		// The store keeps one row per day; summing same-day rows anyway is what stops a duplicate row
		// from either doubling or vanishing depending on which one a fold happened to find first.
		expect(todayMs([row(0, 7), row(1, 40), row(0, 3)], TODAY)).toBe(10 * 60_000);
	});

	it("is zero on the first day, and ignores junk rows", () => {
		expect(todayMs([], TODAY)).toBe(0);
		expect(todayMs([{ day: dayKey(TODAY), ms: -5 }, { day: dayKey(TODAY), ms: Number.NaN }, { day: "", ms: 60_000 }], TODAY)).toBe(0);
	});

	it("adds a live session without letting a negative one subtract", () => {
		expect(todayMs([row(0, 4)], TODAY, 90_000)).toBe(5.5 * 60_000);
		expect(todayMs([row(0, 4)], TODAY, -90_000)).toBe(4 * 60_000);
	});

	it("a year of old rows does not leak into today", () => {
		const rows = Array.from({ length: 365 }, (_, i) => row(i, 20));
		expect(todayMs(rows, TODAY)).toBe(20 * 60_000); // only i=0 is today
	});
});

describe("foldDaily", () => {
	it("appends the session to today's row rather than replacing it", () => {
		const before = foldDaily([], TODAY, 5 * 60_000);
		const after = foldDaily(before, TODAY, 90_000);
		expect(after).toEqual([{ day: dayKey(TODAY), ms: 6.5 * 60_000 }]);
	});

	it("leaves other days untouched when it folds", () => {
		const rows = [row(1, 12), row(0, 3)];
		expect(foldDaily(rows, TODAY, 60_000)[1]).toEqual({ day: dayKey(TODAY), ms: 4 * 60_000 });
		expect(todayMs(rows, TODAY)).toBe(3 * 60_000); // the input was not mutated in place
	});

	it("drops a zero session and a negative one", () => {
		expect(foldDaily([], TODAY, 0)).toEqual([]);
		expect(foldDaily([row(0, 8)], TODAY, -60_000)).toEqual([row(0, 8)]);
	});

	it("prunes days outside the window, keeping yesterday's boundary exact", () => {
		const rows = Array.from({ length: KEEP_DAYS + 3 }, (_, i) => row(i, 5));
		const folded = foldDaily(rows, TODAY, 0);
		expect(folded.length).toBe(KEEP_DAYS);
		expect(folded.map((r) => r.day)).toEqual(rows.slice(0, KEEP_DAYS).map((r) => r.day).reverse());
	});

	it("a midnight-straddling fold lands on the day the session was stamped", () => {
		// end() stamps with Date.now(); the row must match that instant's calendar day, not the day the
		// session began — this is the one double-count a naive "add to today" version can hide.
		const justBeforeMidnight = new Date(new Date(TODAY).setHours(23, 59, 59, 999)).getTime();
		const rows = foldDaily([], justBeforeMidnight, 3 * 60_000);
		expect(rows[0]?.day).toBe(dayKey(justBeforeMidnight));
	});
});

describe("dailyGoal", () => {
	it("floors minutes so 14:59 of a 15-minute goal is not a finished day", () => {
		const g = dailyGoal([row(0, 14)], TODAY, 59_000, 15);
		expect(g).toEqual({ minutes: 14, goalMinutes: 15, pct: 99, reached: false });
	});

	it("clamps at 100% once the goal is met, and says so", () => {
		const g = dailyGoal([row(0, 40)], TODAY, 0, 15);
		expect(g.pct).toBe(100);
		expect(g.reached).toBe(true);
		expect(g.minutes).toBe(40); // the real number stays visible; only the bar clamps
	});

	it("a goal of zero turns the bar off instead of dividing by it", () => {
		expect(dailyGoal([row(0, 10)], TODAY, 0, 0)).toEqual({ minutes: 10, goalMinutes: 0, pct: 0, reached: false });
	});

	it("the very first keystroke of the first session moves the bar", () => {
		const g = dailyGoal([], TODAY, 1_000, 15);
		expect(g.pct).toBe(0);
		expect(g.minutes).toBe(0);
		expect(g.reached).toBe(false);
	});

	it("a long old session does not swamp today", () => {
		// 5 hours practised last week must read as nothing today, or the bar starts every Monday full.
		expect(dailyGoal([row(6, 300)], TODAY, 0, 15).reached).toBe(false);
	});
});
