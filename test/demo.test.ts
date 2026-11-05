import { describe, expect, it } from "vitest";
import { demoSessions, isPreviewHost } from "../src/stats/demo.ts";
import { history } from "../src/stats/history.ts";

const NOW = new Date(2026, 10, 4, 9, 0, 0).getTime();
const gen = (over: { seed?: number; days?: number } = {}) => demoSessions("go60+qwerty", { nowMs: NOW, ...over });

describe("demoSessions", () => {
	it("is the same curve for the same seed", () => {
		// A screenshot in a PR body has to be reproducible, and two reloads of a preview must not differ.
		expect(gen()).toEqual(gen());
		expect(gen({ seed: 7 })).toEqual(gen({ seed: 7 }));
	});

	it("changes with the seed", () => {
		expect(gen({ seed: 7 }).map((r) => r.chars)).not.toEqual(gen({ seed: 8 }).map((r) => r.chars));
	});

	it("leaves rest days in, which is the whole reason the chart breaks its line", () => {
		const h = history(gen({ days: 42 }));
		expect(h.days.length).toBeLessThan(42);
		expect(h.days.length).toBeGreaterThan(10);
	});

	it("produces rows the real reader would accept", () => {
		const rows = gen();
		expect(rows.length).toBeGreaterThan(5);
		expect(rows.length).toBeLessThanOrEqual(50); // the cap the real records are pruned to
		expect(new Set(rows.map((r) => r.rkey)).size).toBe(rows.length);
		for (const r of rows) {
			expect(Number.isInteger(r.chars)).toBe(true);
			expect(Number.isInteger(r.errors)).toBe(true);
			expect(Number.isInteger(r.ms)).toBe(true);
			expect(r.chars).toBeGreaterThan(0);
			expect(r.errors).toBeLessThan(r.chars);
			expect(r.layout).toBe("go60+qwerty");
			expect(r.atMs).toBeLessThanOrEqual(NOW + 86_400_000);
			expect(r.atMs).toBeGreaterThan(NOW - 60 * 86_400_000);
		}
		expect([...rows].sort((a, b) => a.atMs - b.atMs).map((r) => r.atMs)).toEqual(rows.map((r) => r.atMs));
	});

	it("stays inside a speed a person could plausibly type", () => {
		// A preview that shows 400 wpm advertises a lie about the app, which is worse than an empty chart.
		for (const r of gen({ days: 60 })) {
			const wpm = r.chars / (r.ms / 60000) / 5;
			expect(wpm).toBeGreaterThan(8);
			expect(wpm).toBeLessThan(120);
		}
	});

	it("counts each generated day's sessions the way the chart expects", () => {
		const h = history(gen());
		expect(h.sessions).toBe(h.days.reduce((t, d) => t + d.sessions, 0));
	});
});

describe("isPreviewHost", () => {
	it("accepts a branch preview and a hash deploy", () => {
		expect(isPreviewHost("m5-history.keeb.pages.dev", "keeb")).toBe(true);
		expect(isPreviewHost("823e331a.keeb.pages.dev", "keeb")).toBe(true);
	});

	it("rejects the real app, localhost, and anything that merely ends in the right characters", () => {
		expect(isPreviewHost("keeb.thatsit.app", "keeb")).toBe(false);
		expect(isPreviewHost("thatsit.app", "keeb")).toBe(false);
		expect(isPreviewHost("localhost", "keeb")).toBe(false);
		expect(isPreviewHost("localhost:4317", "keeb")).toBe(false);
		expect(isPreviewHost("keeb.pages.dev", "keeb")).toBe(false); // the project apex, not a preview
		expect(isPreviewHost("not-keeb.pages.dev", "keeb")).toBe(false);
		expect(isPreviewHost("x.keeb.pages.dev.evil.example", "keeb")).toBe(false);
		// A branch name containing a dot is not a preview of a deeper app either.
		expect(isPreviewHost("a.b.keeb.pages.dev", "keeb")).toBe(false);
	});
});

describe("the demo's hesitation band", () => {
	// The chart's shaded band comes from the same generator as everything else in the demo, so a generator
	// whose stroke totals were unrelated to its character counts would draw a learner pausing half the time.
	// A PR screenshot is a claim about what real progress looks like.
	it("puts the typing line within a plausible margin of the clock line", () => {
		for (const seed of [20261104, 7, 99, 1234]) {
			const h = history(demoSessions("go60+qwerty", { seed }));
			const ratio = h.strokeWpm / Math.max(1, h.wpm);
			expect(ratio, `seed ${seed} typing/clock`).toBeGreaterThanOrEqual(1.05);
			expect(ratio, `seed ${seed} band too wide to be a learner`).toBeLessThan(1.6);
		}
	});

	it("keeps stroke time inside the wall clock on every day", () => {
		for (const rows of [demoSessions("go60+qwerty", { seed: 5 }), demoSessions("corne+colemak_dh", { seed: 6, days: 30 })]) {
			for (const d of history(rows).days) {
				expect(d.strokeMinutes).toBeLessThanOrEqual(d.minutes);
				if (d.wpm > 0) expect(d.strokeWpm).toBeGreaterThanOrEqual(d.wpm);
			}
		}
	});

	it("still sums the per-key strokes to the session's own character count", () => {
		// The relationship the band's width is built from: strokes are distributed over `chars`, not invented
		// beside it. Checked against the recovered deltas, which is what the chart consumes.
		const rows = demoSessions("go60+qwerty", { seed: 20261104 });
		const ordered = [...rows].sort((a, b) => a.rkey.localeCompare(b.rkey));
		for (let i = 1; i < ordered.length; i += 1) {
			const strokes = Object.keys(ordered[i].stats).reduce((n, k) => n + (ordered[i].stats[k].samples - (ordered[i - 1].stats[k]?.samples ?? 0)), 0);
			expect(Math.abs(strokes - ordered[i].chars)).toBeLessThanOrEqual(1);
		}
	});
});
