// The app measures every key in milliseconds and every goal in characters per minute; words per minute
// is only ever a way of showing that to a person. These tests are the boundary the UI reads from.
import { describe, expect, it } from "vitest";
import { CHARS_PER_WORD, cpmFrom, cpmToWpm, targetTimeMs, timeToTypeMs, wpmFrom, wpmToCpm } from "../src/stats/stats.ts";
import { DEFAULT_SETTINGS } from "../src/data/store.ts";

describe("words per minute", () => {
	it("uses the five-character word", () => {
		expect(CHARS_PER_WORD).toBe(5);
	});

	it("reads the stored default goal as 40 wpm", () => {
		// The default lives in characters so nothing about the change is a migration; this is the number
		// a learner sees on a first run.
		expect(DEFAULT_SETTINGS.targetCpm).toBe(200);
		expect(cpmToWpm(DEFAULT_SETTINGS.targetCpm)).toBe(40);
	});

	it("round-trips a goal typed in words", () => {
		for (const wpm of [15, 20, 40, 60, 80, 120]) expect(cpmToWpm(wpmToCpm(wpm))).toBe(wpm);
	});

	it("agrees between the two ways of getting there", () => {
		// wpmFrom goes from a per-character time, cpmToWpm from a rate. At 300ms/key they describe the
		// same typist and must print the same number, or the "now" and "session" cells would disagree.
		const ms = targetTimeMs(200); // the goal itself: 300ms per character
		expect(ms).toBe(300);
		expect(wpmFrom(ms)).toBe(cpmToWpm(cpmFrom(ms)));
		expect(wpmFrom(ms)).toBe(40);
	});

	it("reports nothing for a key that has never been pressed", () => {
		expect(wpmFrom(0)).toBe(0);
		expect(wpmFrom(-5)).toBe(0);
		expect(cpmToWpm(0)).toBe(0);
	});

	it("keeps a fast typist inside the range the settings field allows", () => {
		// 120 wpm is 600 cpm, the ceiling the number input was built around before the relabel.
		expect(wpmToCpm(120)).toBe(600);
		expect(cpmToWpm(wpmToCpm(120))).toBe(120);
	});

	it("does not lose the goal through the fixed-point storage", () => {
		// ttMs16 is milliseconds x 16; the ladder compares against targetTimeMs, so the round trip has to
		// land back on the same integer it started from.
		const stat = { ttMs16: targetTimeMs(DEFAULT_SETTINGS.targetCpm) * 16, samples: 40, errors: 0 };
		expect(wpmFrom(timeToTypeMs(stat))).toBe(40);
	});
});
