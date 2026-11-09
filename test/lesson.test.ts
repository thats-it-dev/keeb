import { describe, expect, it } from "vitest";
import { keymapById } from "../src/data/keymaps.ts";
import { GO60 } from "../src/data/go60.ts";
import { lesson } from "../src/lesson/generator.ts";
import { press, start } from "../src/lesson/engine.ts";
import { WORDS } from "../src/lesson/corpus.ts";
import { resolve } from "../src/keyboard/resolve.ts";
import { emptyStat, timeToTypeMs } from "../src/stats/stats.ts";

const r = resolve(GO60, keymapById("qwerty"));
const TARGET = 200; // cpm, a 300ms-per-character goal

// A fake typist with a fixed speed per character, so a slow key should show up as drilled more.
const SPEED: Record<string, number> = { s: 90, t: 95, a: 110, r: 130, n: 140, e: 120, i: 260, o: 150, g: 170, m: 240 };

function typeRun(e: ReturnType<typeof start>, from = 1000) {
	let engine = e;
	let now = from;
	let mistakes = 0;
	for (let guard = 0; guard < 20000; guard += 1) {
		const want = [...engine.text][engine.index];
		if (want === undefined) break;
		const wrong = guard % 41 === 40 && mistakes < 6;
		if (wrong) mistakes += 1;
		const res = press(engine, r, wrong ? "z" : want, now, TARGET);
		engine = res.engine;
		if (res.finished) break;
		now += SPEED[want] ?? 220;
	}
	return { engine, now, mistakes };
}

const LETTERS = Object.keys(SPEED);
const SPEED_KEYS = LETTERS.length;

describe("lesson engine", () => {
	it("starts a brand new learner on the home row, with real words", () => {
		const e = start(r, {}, TARGET);
		expect(e.pending).not.toBe("");
		// Every touched key of the home row is the starting group: 10 keys, and that is the point
		// where English words exist. Nothing else may appear in the first line.
		// Home row letters, punctuation excluded: a s d f g | h j k l.
		expect(e.ladder.unlocked.map((id) => r.byId.get(id)?.char).sort().join("")).toBe("adfghjkls");
		const words = e.text.split(" ");
		expect(words.length).toBeGreaterThan(6);
		expect(words.every((w) => /^[a-z]+$/.test(w))).toBe(true);
		expect(words.filter((w) => w.length > 1).length).toBeGreaterThan(4);
		expect(WORDS.some((w) => w === words[0])).toBe(true);
	});

	it("records one sample per keystroke and one error per mistake", () => {
		const e = start(r, {}, TARGET);
		const ok = press(e, r, [...e.text][e.index], 5000, TARGET);
		expect(ok.accepted).toBe(true);
		expect(ok.engine.stats[ok.targetId]?.samples).toBe(1);
		const bad = press(ok.engine, r, "q", 6000, TARGET);
		expect(bad.accepted).toBe(false);
		expect(bad.engine.index).toBe(ok.engine.index);
		expect((bad.engine.stats[bad.targetId] ?? emptyStat()).errors).toBeGreaterThanOrEqual(1);
	});

	// The keyboard lights what the fingers hit; the statistics still blame the key being drilled.
	it("separates the key pressed from the key wanted", () => {
		const e = start(r, {}, TARGET);
		const want = [...e.text][e.index];
		const straight = press(e, r, want, 5000, TARGET);
		expect(straight.pressedId).toBe(straight.targetId);
		const other = want === "q" ? "z" : "q";
		const slip = press(e, r, other, 5000, TARGET);
		expect(slip.pressedId).toBe(r.byChar.get(other));
		expect(slip.pressedId).not.toBe(slip.targetId);
		expect(slip.targetId).toBe(e.pending);
	});

	it("measures the slow key as slow", () => {
		// Feed a fixed speed per character straight into the stats, then read the numbers back.
		let engine = start(r, {}, TARGET);
		for (const [ch, ms] of Object.entries(SPEED)) {
			const id = r.byChar.get(ch);
			expect(id, ch).toBeTruthy();
			engine = { ...engine, stats: { ...engine.stats, [id!]: { ttMs16: ms * 16, samples: 40, errors: 0 } } };
		}
		expect(Object.keys(engine.stats).length).toBe(SPEED_KEYS);
		expect(timeToTypeMs(engine.stats[r.byChar.get("m")!])).toBe(240);
		expect(timeToTypeMs(engine.stats[r.byChar.get("s")!])).toBe(90);
	});

	it("unlocks the next key once the current one is up to speed", () => {
		const fresh = start(r, {}, TARGET);
		expect(fresh.ladder.next).toBeDefined();
		const after = typeRun(fresh).engine;
		expect(after.ladder.unlocked.length).toBeGreaterThanOrEqual(fresh.ladder.unlocked.length);
	});

	it("never asks for a character that is not unlocked", () => {
		const { engine } = typeRun(start(r, {}, TARGET));
		const unlocked = new Set(engine.ladder.unlocked.map((id) => r.byId.get(id)?.char.toLowerCase()));
		for (const ch of new Set([...engine.text])) {
			if (ch === " ") continue;
			expect(unlocked.has(ch), ch).toBe(true);
		}
	});

	it("keeps the corpus broad enough for every letter", () => {
		for (const ch of "abcdefghijklmnopqrstuvwxyz") {
			expect(WORDS.filter((w) => w.includes(ch)).length, ch).toBeGreaterThan(15);
		}
	});

	it("generates a deterministic lesson from the same stats", () => {
		const stats = typeRun(start(r, {}, TARGET)).engine.stats;
		const a = lesson(["s", "t", "a", "r"], stats, TARGET, r.byChar);
		const b = lesson(["s", "t", "a", "r"], stats, TARGET, r.byChar);
		expect(a.text).toBe(b.text);
	});

	it("drills the weak key more often than a fast one", () => {
		const stats: Record<string, { ttMs16: number; samples: number; errors: number }> = {};
		for (const [ch, ms] of Object.entries(SPEED)) {
			const id = r.byChar.get(ch);
			if (id) stats[id] = { ttMs16: ms * 16, samples: 40, errors: ch === "i" ? 8 : 0 };
		}
		const letters = Object.keys(SPEED);
		const text = lesson(letters, stats, TARGET, r.byChar, 40).text;
		const count = (ch: string) => [...text].filter((c) => c === ch).length;
		expect(count("s")).toBeGreaterThan(count("i") / 4);
		expect(text.length).toBeGreaterThan(40);
	});

	it("does not credit the first keystroke of a run with infinite speed", () => {
		// The bug this pins: press() sets stamp to 0 at a run boundary so the pause between runs is never
		// charged to a key -- correct intent, wrong consequence. elapsedMs came out as 0, and 0 went into the
		// EWMA as a measurement of "instantly". A key that happened to START a line came out at 429 wpm while
		// every other row sat near 230ms, and the screen's average read faster than every key inside it.
		const e = start(r, {}, TARGET);
		const first = [...e.text][0]!;
		const res = press(e, r, first, 5000, TARGET);
		const stat = res.engine.stats[res.targetId]!;
		expect(stat.samples).toBe(1); // the stroke happened, so it counts as a character typed
		expect(stat.ttMs16).toBe(0); // but nothing was measured, so the mean has no observation in it
		expect(timeToTypeMs(stat)).toBe(0); // which reads as "unknown", not as "0ms"
		// And the next stroke, which DOES have an earlier stroke to measure against, is timed properly.
		const want2 = [...res.engine.text][res.engine.index]!;
		const second = press(res.engine, r, want2, 5200, TARGET);
		const after = second.engine.stats[second.targetId]!;
		expect(after.ttMs16).toBe(200 * 16); // the 200ms gap, in fixed point, not a third of it and not 0
	});

	it("keeps an average from coming out faster than every key it averages", () => {
		// Michael's report was exactly this: the headline said 59 wpm, the rows said 51-53. An untimed
		// keystroke at a run boundary dragged one key's mean toward zero, and the mean of means followed it.
		const e = start(r, {}, TARGET);
		let engine = e;
		let now = 1000;
		for (let i = 0; i < 400 && [...engine.text][engine.index] !== undefined; i += 1) {
			const want = [...engine.text][engine.index]!;
			const res = press(engine, r, want, now, TARGET);
			engine = res.engine;
			now += 230; // a fixed, machine-honest cadence
		}
		const rows = Object.values(engine.stats).filter((s) => timeToTypeMs(s) > 0);
		expect(rows.length).toBeGreaterThan(3);
		const slowest = Math.max(...rows.map((s) => timeToTypeMs(s)));
		const fastest = Math.min(...rows.map((s) => timeToTypeMs(s)));
		// Every observation came from the same 230ms cadence, so no key may be timed under it, and the
		// EWMA's floor is the first real interval after a run boundary.
		expect(fastest).toBeGreaterThanOrEqual(200);
		expect(slowest).toBeLessThan(600);
	});

});
