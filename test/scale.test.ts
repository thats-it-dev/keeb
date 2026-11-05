import { describe, expect, it } from "vitest";
import { barWidth, GOAL_AT } from "../src/stats/overview.ts";

// barWidth is `clamp(round(50 - 25 * log2(ms / goal)), 2, 100)`. A SLOWER key gets a SHORTER bar -- that is
// the direction, and it is the opposite of the "confidence" reading people expect from a progress bar.
// Every number below is measured from that formula: an earlier draft of this file guessed both the
// saturation point and the monotonic direction, and got both wrong.

describe("barWidth", () => {
	it("puts a key at the goal speed at the middle of the scale", () => {
		expect(barWidth(250, 250)).toBe(GOAL_AT);
		expect(GOAL_AT).toBe(50);
	});

	it("is symmetric in time around the goal", () => {
		// Each doubling or halving of ms moves 25 points, so a key twice as slow and a key twice as fast take
		// up the same room. That symmetry is the whole reason for the log scale.
		expect(barWidth(500, 250) - GOAL_AT).toBe(-25);
		expect(barWidth(125, 250) - GOAL_AT).toBe(25);
	});

	it("grows shorter as a key gets slower, never the reverse", () => {
		// The regression that motivated the scale: goal-relative bars clamped anything faster than 2x goal at
		// 100%, so a fast run drew one uniform row and ranked nothing. Monotonic decreasing is the invariant.
		for (const goal of [80, 250, 600]) {
			let prev = Infinity;
			for (let ms = 1; ms <= goal * 8; ms += 1) {
				const w = barWidth(ms, goal);
				expect(w, `ms=${ms} goal=${goal}`).toBeLessThanOrEqual(prev);
				prev = w;
			}
		}
	});

	it("ranks distinct times by distinct widths", () => {
		// The property the browser test needs, stated where no wall clock can take part: different keystroke
		// timings have to give different bars, or the screen is decoration.
		const times = Array.from({ length: 40 }, (_, i) => 20 + i * 12); // 20 ms to 500 ms
		const widths = times.map((ms) => barWidth(ms, 100));
		expect(new Set(widths).size).toBe(31); // 40 times, 31 widths: rounding collides, but never flattens
		for (let i = 1; i < times.length; i += 1) expect(widths[i]).toBeLessThanOrEqual(widths[i - 1]!);
	});

	it("saturates both ends, and pins where", () => {
		// The scale resolves about 1.6 ms per point at a 100 ms goal and degrades geometrically: 8 ms per
		// point at 40 ms, 40 ms per point at 200 ms. Naming the ends stops a future tweak from flattening the
		// middle where a learner actually types.
		expect(barWidth(20, 100)).toBe(100); // ceiling: any key under ~62.5 ms against a 100 ms goal
		expect(barWidth(40, 100)).toBe(83);
		expect(barWidth(62, 100)).toBe(67);
		expect(barWidth(5000, 250)).toBe(2); // floor: 20x slower than goal
		expect(barWidth(100_000, 250)).toBe(2); // and it stays there rather than vanishing
	});

	it("stays inside the row at any speed", () => {
		for (const [ms, goal] of [[1, 250], [5, 250], [250, 250], [5000, 250], [100_000, 250], [20, 500], [4000, 80]]) {
			const w = barWidth(ms, goal);
			expect(w, `${ms}ms at goal ${goal}`).toBeGreaterThanOrEqual(2);
			expect(w).toBeLessThanOrEqual(100);
		}
	});

	it("returns nothing for a key or a goal that does not exist", () => {
		expect(barWidth(0, 250)).toBe(0);
		expect(barWidth(250, 0)).toBe(0);
		expect(barWidth(-5, 250)).toBe(0);
	});
});
