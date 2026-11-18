// The per-key mean is the number every other screen reads: the keycap, the goal bar, the ladder, the
// headline wpm. These are the tests for what goes INTO it.
import { describe, expect, it } from "vitest";
import { bestConfidence, bestTimeMs, emptyStat, hasTiming, merge, observe, observeError, progressGrowth, routeId, routeKey, routeLayer, timeToTypeMs, TRUST_SAMPLES, type KeyStat } from "../src/stats/stats.ts";

const stroke = (ms: number) => Math.round(ms) * 16;

/** Type `ms` for `n` strokes, the way the engine does. */
const typeAt = (ms: number, n: number, from: KeyStat = emptyStat()): KeyStat => {
	let s = from;
	for (let i = 0; i < n; i += 1) s = observe(s, ms);
	return s;
};

describe("the trust floor", () => {
	// What the curriculum unlocks on must be a believable mean, not one lucky keystroke. The measured bug:
	// a learner a hair under goal who got one fast stroke on a brand-new letter had that stroke become the
	// letter's whole mean (the cold seed), permanently at goal, so the next letter arrived on the next line —
	// and the next, in cascade. keybr avoids this by earning `best` from session aggregates; we cannot
	// (there is no session until the pane closes), so `best` may not be claimed before the mean has two
	// alpha horizons of strokes behind it (TRUST_SAMPLES).
	it("does not let one lucky stroke earn a key's best", () => {
		let s = observe(emptyStat(), 200); // the cold seed lands under the 300 ms goal
		for (let i = 0; i < TRUST_SAMPLES - 1; i += 1) s = observe(s, 320); // slower than goal ever after
		expect(s.samples).toBe(TRUST_SAMPLES);
		expect(bestConfidence(s, 200)).toBeLessThan(1);
	});

	it("earns the best once the mean has enough evidence behind it", () => {
		const s = typeAt(200, TRUST_SAMPLES);
		expect(bestConfidence(s, 200)).toBeGreaterThanOrEqual(1);
	});

	it("credits nothing to a key with too few strokes, however fast they were", () => {
		expect(bestConfidence(typeAt(200, 5), 200)).toBe(0);
	});
});

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
		// And one stroke, however fast, is not yet a claim of best — the trust floor has not been met.
		expect(observeError(emptyStat(), 200)).toEqual({ ttMs16: stroke(200), samples: 1, errors: 1 });
	});

	it("keeps the fastest mean, not the latest one", () => {
		// What the curriculum unlocks on. A key that ran at goal speed long enough to be believed, and then
		// spent an hour hunting and pecking, must still read as taught, or the ladder hands the letter out
		// again.
		let s = typeAt(200, TRUST_SAMPLES); // the mean is believable now, and it was at goal the whole time
		s = observe(s, 4_000); // the outlier ceiling files this as the slowest keystroke the key has evidence for
		expect(timeToTypeMs(s)).toBeGreaterThan(200); // the running mean did go slow
		expect(bestTimeMs(s)).toBe(200); // and the curriculum still reads the fastest it ever ran
		// And the claim only ever gets faster: a slow streak cannot lower it.
		expect(bestTimeMs(observe(s, 4_000))).toBe(200);
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

// What a second device's progress record can honestly say between two of its snapshots. The count is
// arithmetic; the mean is not, because this is an exponentially weighted mean and the old strokes have
// already been decayed out of it.
describe("growth between two snapshots of one record", () => {
	it("says a device that got faster is faster", () => {
		// Subtracting mean x samples here produced a NEGATIVE total — the record's mean had fallen faster than
		// the sample count rose — and the clamp turned that into "no timing in this delta". The strokes were
		// counted and their speed taught nothing: the fold left the other device at 400 ms.
		const established = typeAt(100, 100);
		const improved = typeAt(40, 10, established);
		const growth = progressGrowth({ a: established }, { a: improved }).a!;
		expect(hasTiming(growth)).toBe(true);
		const merged = merge(typeAt(400, 10), growth);
		expect(timeToTypeMs(merged)).toBeLessThan(400); // it learned the key got faster
		expect(timeToTypeMs(merged)).toBeGreaterThan(40); // without leaping to the fastest stroke either
	});

	it("says a device that got slower is slower, without exaggerating it", () => {
		// The same subtraction in the other direction: four strokes at 400 ms on a key with a long history
		// came out as 1875 ms, and that number then weighted the merged average of a whole board.
		const established = typeAt(100, 100);
		const slowed = typeAt(400, 4, established);
		const merged = merge(typeAt(400, 10), progressGrowth({ a: established }, { a: slowed }).a!);
		expect(timeToTypeMs(merged)).toBeGreaterThan(100);
		expect(timeToTypeMs(merged)).toBeLessThanOrEqual(400); // 400 ms is the slowest thing anyone typed
	});

	it("counts the strokes that arrived, and only those", () => {
		const established = typeAt(100, 30);
		const later = typeAt(100, 12, established);
		const growth = progressGrowth({ a: established }, { a: later }).a!;
		expect(growth.samples).toBe(12);
		expect(merge(established, growth).samples).toBe(42);
		expect(progressGrowth({ a: established }, { a: established })).toEqual({});
	});
});

describe("route ids", () => {
	it("keeps the base layer on the bare key id", () => {
		expect(routeId(0, "L_C5R3")).toBe("L_C5R3");
		expect(routeLayer("L_C5R3")).toBe(0);
		expect(routeKey("L_C5R3")).toBe("L_C5R3");
	});

	it("round-trips a suffixed id", () => {
		const id = routeId(2, "L_C4R4");
		expect(id).toBe("L_C4R4.2");
		expect(routeLayer(id)).toBe(2);
		expect(routeKey(id)).toBe("L_C4R4");
	});

	it("parses ids that never had a layer", () => {
		expect(routeLayer(routeId(0, "R_T2"))).toBe(0);
		expect(routeKey(routeId(12, "a"))).toBe("a"); // key ids are dot-free, so the suffix is unambiguous
		expect(routeId(12, "a")).toBe("a.12");
	});
});
