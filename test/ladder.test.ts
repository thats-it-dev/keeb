// The unlock ladder is the curriculum. It has to do two things at once: never hand out a letter the
// learner cannot type, and never hand out more than one letter at a time.
import { describe, expect, it } from "vitest";
import { GO60 } from "../src/data/go60.ts";
import { keymapById } from "../src/data/keymaps.ts";
import { resolve } from "../src/keyboard/resolve.ts";
import { press, start } from "../src/lesson/engine.ts";
import { ladder } from "../src/stats/ladder.ts";
import { emptyStat, type StatMap } from "../src/stats/stats.ts";

const r = resolve(GO60, keymapById("qwerty"));
const TARGET = 200; // cpm -> 300 ms per character
const GOAL_MS16 = 16 * Math.round(60_000 / TARGET);

/** Every key on screen at goal speed, with more than enough reps to be believed. */
const allAtGoal = (ids: string[], samples = 40): StatMap => {
	const out: StatMap = {};
	for (const id of ids) out[id] = { ttMs16: GOAL_MS16, samples, errors: 0 };
	return out;
};

const unlockedChars = (m: StatMap) => ladder(r, m, TARGET).unlocked.map((id) => r.byId.get(id)?.char ?? "?");

describe("the unlock ladder", () => {
	it("starts a learner with no practice on the home row alone", () => {
		const l = ladder(r, {}, TARGET);
		expect(l.unlocked.length).toBeGreaterThan(1);
		expect(l.next).toBeDefined();
	});

	it("unlocks one key when the whole starting group is up to speed", () => {
		// The bug this pins: the loop asked whether every *practised* unlocked key was ready, and a key you
		// have struck fewer than ten times is not practised, so it never blocked anything. The moment the
		// home row cleared the goal the loop walked the entire alphabet and every letter appeared at once.
		const start1 = ladder(r, {}, TARGET);
		const ready = allAtGoal(start1.unlocked);
		const l = ladder(r, ready, TARGET);
		expect(l.unlocked.length).toBe(start1.unlocked.length + 1);
		expect(l.unlocked.slice(start1.unlocked.length)).toEqual([start1.next]);
		expect(l.next).toBeDefined();
		expect(l.next).not.toBe(start1.next);
	});

	it("unlocks a second key only once the first new one has been typed at speed", () => {
		const first = ladder(r, {}, TARGET);
		const withOneReady = { ...allAtGoal(first.unlocked), [first.next!]: { ttMs16: GOAL_MS16, samples: 40, errors: 0 } };
		const l = ladder(r, withOneReady, TARGET);
		expect(l.unlocked.length).toBe(first.unlocked.length + 2);
		expect(l.unlocked).toContain(first.next!);
	});

	it("holds the line when the newest key has been given out but never practised", () => {
		// The other half of the bug: an earned key with no samples must block, or the next sync of stats
		// opens the board again.
		const first = ladder(r, {}, TARGET);
		const stats = allAtGoal(first.unlocked);
		const l = ladder(r, { ...stats, [first.next!]: emptyStat() }, TARGET);
		expect(l.unlocked.length).toBe(first.unlocked.length + 1);
	});

	it("will not unlock on a slow home row, however many letters are waiting", () => {
		const first = ladder(r, {}, TARGET);
		const stats = allAtGoal(first.unlocked);
		const [one] = first.unlocked;
		ladder(r, stats, TARGET); // the ready case, for contrast
		expect(ladder(r, { ...stats, [one!]: { ttMs16: GOAL_MS16 * 3, samples: 40, errors: 0 } }, TARGET).unlocked.length).toBe(first.unlocked.length);
	});

	it("grows one letter at a time while a learner types", () => {
		// End to end, through the engine that rebuilds the ladder at every run boundary: no line of
		// practice may hand out two letters, and no line may hand out a letter the previous one earned.
		let e = start(r, {}, TARGET);
		let now = 1_000;
		let was = e.ladder.unlocked.length;
		let grew = 0;
		for (let i = 0; i < 600; i += 1) {
			const want = [...e.text][e.index];
			if (want === undefined) break;
			const res = press(e, r, want, now, TARGET);
			e = res.engine;
			now += 200; // inside the 300 ms goal, so keys do clear it
			const is = e.ladder.unlocked.length;
			if (is !== was) {
				expect(is - was, `letters added by one run: ${unlockedChars(e.stats).join("")}`).toBeLessThanOrEqual(1);
				grew += is - was;
				was = is;
			}
			if (res.finished && i > 500) break;
		}
		expect(grew, "the ladder should have opened at least one letter in 600 strokes").toBeGreaterThan(0);
	});
});
