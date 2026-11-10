// The per-key mean is the number every other screen reads: the keycap, the goal bar, the ladder, the
// headline wpm. These are the tests for what goes INTO it.
import { describe, expect, it } from "vitest";
import { emptyStat, hasTiming, observe, observeError, timeToTypeMs, type KeyStat } from "../src/stats/stats.ts";

const stroke = (ms: number) => Math.round(ms) * 16;

/** Type `ms` for `n` strokes, the way the engine does. */
const typeAt = (ms: number, n: number, from: KeyStat = emptyStat()): KeyStat => {
	let s = from;
	for (let i = 0; i < n; i += 1) s = observe(s, ms);
	return s;
};

describe("the per-key average", () => {
	it("moves one sixteenth of the way to the newest stroke", () => {
		// The bug this pins: ALPHA16 was documented as a 1/16 weight and applied as a weight of 1, so
		// `mean + 1 * (sample - mean)` returned the sample. Every key's "average" was its last keystroke,
		// which is why one stray stroke could print 12 wpm for a key typed two hundred times.
		const ten = typeAt(400, 10);
		expect(timeToTypeMs(ten)).toBe(400); // every observation was the same, so the mean sits there exactly
		const after = observe(ten, 40);
		// 400 + (40 - 400)/16 = 377.5, and the stored unit is ms x 16, so the honest answer is 378.
		expect(timeToTypeMs(after)).toBe(378);
		expect(timeToTypeMs(after)).not.toBe(40);
	});

	it("does not let one long pause carry the average away", () => {
		// A stroke is only evidence about typing when it follows another stroke. The gap after you went to
		// make tea is a gap about the kettle. Measured as it stood, one 40-second pause moved a key from
		// 121 wpm to 17, and the headline average dragged with it.
		const warm = typeAt(40, 20);
		const paused = observe(warm, 40_000);
		expect(timeToTypeMs(paused)).toBeLessThan(120); // at most 4x the mean it replaces: 160 -> 167ms
		expect(timeToTypeMs(paused)).toBeGreaterThan(40); // and it is still allowed to notice a slower spell
	});

	it("counts a stroke it refuses to time", () => {
		// Clamping the observation must not lose the rep: samples is exposure, ttMs16 is speed.
		const s = observe(typeAt(40, 5), 40_000);
		expect(s.samples).toBe(6);
		expect(hasTiming(s)).toBe(true);
	});

	it("still takes the first timed stroke as its seed", () => {
		// No prior mean means nothing to weight against. This is what the run-boundary test in
		// lesson.test.ts reads back, and what the session-diffing in insights.ts inverts.
		expect(observe(emptyStat(), 200).ttMs16).toBe(stroke(200));
		expect(observeError(emptyStat(), 200)).toEqual({ ttMs16: stroke(200), samples: 1, errors: 1 });
	});

	it("caps a cold key's seed so a first pause cannot stick for a hundred strokes", () => {
		// A key's very first timed stroke is the only pause this module cannot judge against anything: there
		// is no mean yet to clamp four times. So the seed gets an absolute ceiling instead.
		const cold = observe(emptyStat(), 40_000);
		expect(timeToTypeMs(cold)).toBeLessThanOrEqual(2_000);
		let s = cold;
		for (let i = 0; i < 30; i += 1) s = observe(s, 40);
		expect(timeToTypeMs(s)).toBeLessThan(600); // recovers inside a lesson, rather than haunting one
	});

	it("converges on a changed speed in a lesson's worth of strokes", () => {
		// Responsiveness, the other half of the trade. 1/16 per stroke reaches the neighbourhood of a new
		// cadence in ~30 strokes, which is one line of practice, not one keystroke and not one hundred.
		let s = typeAt(500, 20);
		for (let i = 0; i < 30; i += 1) s = observe(s, 100);
		expect(timeToTypeMs(s)).toBeLessThan(200);
	});

	it("keeps an unmeasured stroke out of the mean but in the count", () => {
		const s = observe(observe(emptyStat(), 100), 0);
		expect(s.samples).toBe(2);
		expect(s.ttMs16).toBe(stroke(100));
	});
});
