import { describe, expect, it } from "vitest";
import { overview, barWidth, wpm, type KeyInfo } from "../src/stats/overview.ts";
import { emptyStat, type StatMap } from "../src/stats/stats.ts";

const goalCpm = 240; // 250 ms per key
const key = (id: string, hand: KeyInfo["hand"] = "left"): KeyInfo => ({ id, label: id.toUpperCase(), hand });
const ROW = ["a", "s", "d", "f", "g", "h", "j", "k", "l"].flatMap((c, i) => [key(c, i < 4 ? "left" : "right")]);

// A stat at exactly `ms`, with enough samples that the ladder would treat it as measured.
const at = (ms: number, samples = 40, errors = 0) => ({ ttMs16: ms * 16, samples, errors });

describe("barWidth", () => {
	it("puts the goal in the middle and doubles and halves symmetrically", () => {
		expect(barWidth(250, 250)).toBe(50);
		expect(barWidth(500, 250)).toBe(25); // twice as slow
		expect(barWidth(125, 250)).toBe(75); // twice as fast, same distance the other way
	});

	it("rises monotonically as the key gets faster, so a longer bar always means a quicker key", () => {
		const ms = [900, 600, 400, 250, 150, 90, 40, 20];
		const w = ms.map((m) => barWidth(m, 250));
		expect([...w].sort((a, b) => a - b)).toEqual(w);
	});

	it("stays inside the track and leaves a trace of a bar at the extremes", () => {
		for (const m of [1, 10, 250, 10_000, 100_000]) expect(barWidth(m, 250)).toBeGreaterThanOrEqual(2);
		for (const m of [1, 10, 250, 10_000]) expect(barWidth(m, 250)).toBeLessThanOrEqual(100);
	});

	it("draws nothing for a key with no timing or no goal", () => {
		expect(barWidth(0, 250)).toBe(0);
		expect(barWidth(200, 0)).toBe(0);
	});
});

describe("overview", () => {
	it("puts the slowest practised key first", () => {
		const o = overview({ a: at(180), s: at(420) }, goalCpm, ROW, { unlocked: ["a", "s"] });
		expect(o.slowest[0]?.id).toBe("s");
		expect(o.keys[0]?.id).toBe("s");
	});

	it("does not treat a never-practised key as infinitely slow", () => {
		// This is the bug the whole file exists to prevent: an untried key has ttMs16 0, so timeToTypeMs
		// returns 0, and 0 ms per key reads as instant. Sorting by ms alone would rank it best.
		const o = overview({ a: at(300) }, goalCpm, ROW, { unlocked: ["a", "s", "d"] });
		expect(o.keys.at(-1)?.samples).toBe(0);
		expect(o.keys.filter((r) => r.samples > 0).length).toBe(1);
		expect(o.avgMs).toBe(300); // a mean over `a` only, not over nine keys
		expect(o.covered).toBe(1);
		expect(o.slowest.map((r) => r.id)).toEqual(["a"]);
	});

	it("separates keys the ladder opened from keys actually used", () => {
		const o = overview({ a: at(200) }, goalCpm, ROW, { unlocked: ["a", "s", "d"] });
		expect(o.untried.map((r) => r.id)).toEqual(["s", "d"]);
		expect(o.unlocked).toBe(3);
		expect(o.covered).toBe(1);
	});

	it("marks the key the curriculum says comes next", () => {
		const o = overview({ a: at(200), s: at(200) }, goalCpm, ROW, { unlocked: ["a", "s"], next: "d" });
		expect(o.keys.find((r) => r.next)?.id).toBe("d");
		// Nothing named, nothing highlighted: a fully unlocked board has no next.
		expect(overview({ a: at(200) }, goalCpm, ROW, { unlocked: ["a"] }).keys.some((r) => r.next)).toBe(false);
	});

	it("uses the same confidence the ladder gates on, uncapped", () => {
		// Capping at 1 would look nicer in a bar chart and disagree with what unlocks, so the number is
		// left raw and the view clips it instead.
		const fast = overview({ a: at(50) }, goalCpm, ROW, { unlocked: ["a"] });
		expect(fast.keys[0]?.conf).toBeGreaterThan(1);
		expect(overview({ a: at(250) }, goalCpm, ROW, { unlocked: ["a"] }).keys[0]?.conf).toBe(1);
	});

	it("reports a ready percentage over practised keys only", () => {
		const o = overview({ a: at(200), s: at(400), d: at(120) }, goalCpm, ROW, { unlocked: ["a", "s", "d", "f"] });
		expect(o.readyPct).toBe(67); // two of three faster than the 250ms goal; f has no data to judge
	});

	it("weights the hand balance by samples, not by keys", () => {
		// Ten left-hand keys with one sample each must not outweigh one right-hand key struck a lot.
		const keys = [key("a", "left"), key("b", "left"), key("c", "right")];
		const o = overview({ a: at(200, 1), b: at(200, 1), c: at(200, 8) }, goalCpm, keys, { unlocked: ["a", "b", "c"] });
		expect(o.leftSamples).toBe(2);
		expect(o.rightSamples).toBe(8);
		expect(o.handBalance).toBe(20);
	});

	it("says 50/50 when there is nothing to balance", () => {
		const o = overview({}, goalCpm, ROW, { unlocked: ROW.map((k) => k.id) });
		expect(o.handBalance).toBe(50);
		expect(o.avgWpm).toBe(0);
		expect(o.errPct).toBe(0);
		expect(o.keys.every((r) => r.samples === 0)).toBe(true);
	});

	it("counts error rate from samples, and only where there are samples", () => {
		const o = overview({ a: at(200, 20, 5), s: emptyStat() }, goalCpm, ROW, { unlocked: ["a", "s"] });
		expect(o.keys.find((r) => r.id === "a")?.err).toBe(0.25);
		expect(o.keys.find((r) => r.id === "s")?.err).toBe(0);
	});

	it("shows a key from another layout without breaking the totals", () => {
		// After a board switch the record can still hold ids this layout never had (progress pulled from
		// another layout). They are not in `keys`, so they must not steal a row or skew the mean.
		const o = overview({ a: at(200), zzz: at(900) }, goalCpm, ROW, { unlocked: ["a"] });
		expect(o.keys.map((r) => r.id)).not.toContain("zzz");
		expect(o.avgMs).toBe(200);
	});

	it("keeps the goal at zero from dividing anything", () => {
		const o = overview({ a: at(200) }, 0, ROW, { unlocked: ["a"] });
		expect(o.keys[0]?.conf).toBe(0);
		expect(o.readyPct).toBe(0);
	});

	it("marks the key the lesson is built around", () => {
		// The ring on the board, the cell in the readout and this row all read the same field.
		const keys = [key("1", "left"), key("9", "right"), key("a", "left"), key("q", "left")];
		const o = overview({ a: at(200) }, goalCpm, keys, { unlocked: ["a"], focus: "q" });
		expect(o.keys.find((r) => r.focus)?.id).toBe("q");
		expect(o.focusLabel).toBe("Q"); // the label, not the id — the readout shows what the keycap says
		expect(o.focusId).toBe("q");
		expect(overview({ a: at(200) }, goalCpm, keys, { unlocked: ["a"] }).focusLabel).toBe("");
	});

	it("splits keys into measured, unlocked-and-untried, and still locked", () => {
		const keys = [key("a", "left"), key("s", "left"), key("q", "left"), key("1", "right")];
		const o = overview({ a: at(200) }, goalCpm, keys, { unlocked: ["a", "s"] });
		expect(o.measured.map((r) => r.id)).toEqual(["a"]);
		expect(o.untried.map((r) => r.id)).toEqual(["s"]);
		expect(o.waiting.map((r) => r.id).sort()).toEqual(["1", "q", "s"]);
	});

	it("converts ms per key to wpm at five characters to the word", () => {
		expect(wpm(250)).toBe(48);
		expect(wpm(0)).toBe(0);
	});
});
