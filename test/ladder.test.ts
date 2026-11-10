// The ladder is the curriculum: which letters are in the lesson, which one the lesson is built around, and
// which one comes next. Two rules have to hold at once — never hand out a letter the learner cannot type,
// and never hand out more than one letter at a time.
import { describe, expect, it } from "vitest";
import { GO60 } from "../src/data/go60.ts";
import { keymapById } from "../src/data/keymaps.ts";
import { resolve } from "../src/keyboard/resolve.ts";
import { press, start } from "../src/lesson/engine.ts";
import { ladder, START_SIZE, teachingOrder } from "../src/lesson/ladder.ts";
import { roleOf } from "../src/keyboard/geometry.ts";
import { emptyStat, type KeyStat, type StatMap } from "../src/stats/stats.ts";

const r = resolve(GO60, keymapById("qwerty"));
const TARGET = 200; // cpm -> 300 ms per character
const GOAL_MS16 = 16 * Math.round(60_000 / TARGET);
const SLOW_MS16 = GOAL_MS16 * 3;

/** Every key on screen at goal speed, with more than enough reps to be believed. `best` follows the mean
 *  unless a slower current mean is asked for, which is what a bad week looks like. */
const atGoal = (ids: string[], samples = 40, nowMs16 = GOAL_MS16): StatMap => {
	const out: StatMap = {};
	for (const id of ids) out[id] = { ttMs16: nowMs16, bestMs16: GOAL_MS16, samples, errors: 0 };
	return out;
};

const chars = (ids: string[]) => ids.map((id) => r.byId.get(id)?.char ?? "?");
const unlockedChars = (m: StatMap) => chars(ladder(r, m, TARGET).unlocked);

describe("the curriculum", () => {
	it("starts a learner with no practice on six letters, and six only", () => {
		const l = ladder(r, {}, TARGET);
		expect(l.unlocked.length).toBe(START_SIZE);
		expect(l.next).toBeDefined();
		// The six are the language's own most frequent letters, not a home row. A learner on any layout is
		// handed the same six, because the thing they need is words.
		expect(chars(r.keys.map((k) => k.id)).join("")).toContain("e");
	});

	it("opens the next letter when every letter it has is at goal", () => {
		// The bug this pins: a loop that asked whether every *practised* key was ready never blocked, because
		// a key with three samples is not practised. One letter crossing the line opened the alphabet.
		const first = ladder(r, {}, TARGET);
		const l = ladder(r, atGoal(first.unlocked), TARGET);
		expect(l.unlocked.length).toBe(first.unlocked.length + 1);
		expect(l.unlocked.slice(first.unlocked.length)).toEqual([first.next]);
		expect(l.next).not.toBe(first.next);
	});

	it("opens a second letter only once the first new one has been at goal", () => {
		const first = ladder(r, {}, TARGET);
		const l = ladder(r, { ...atGoal(first.unlocked), [first.next!]: { ttMs16: GOAL_MS16, bestMs16: GOAL_MS16, samples: 40, errors: 0 } }, TARGET);
		expect(l.unlocked.length).toBe(first.unlocked.length + 2);
		expect(l.unlocked).toContain(first.next!);
	});

	it("holds the line when the newest letter has been handed out but never typed", () => {
		const first = ladder(r, {}, TARGET);
		const l = ladder(r, { ...atGoal(first.unlocked), [first.next!]: emptyStat() }, TARGET);
		expect(l.unlocked.length).toBe(first.unlocked.length + 1);
	});

	it("will not open further letters on a slow start group, however many are waiting", () => {
		const first = ladder(r, {}, TARGET);
		const [one] = first.unlocked;
		const l = ladder(r, { ...atGoal(first.unlocked), [one!]: { ttMs16: SLOW_MS16, bestMs16: SLOW_MS16, samples: 40, errors: 0 } }, TARGET);
		expect(l.unlocked.length).toBe(first.unlocked.length);
	});

	it("keeps a letter unlocked through the week it went slow, because unlocking reads the best", () => {
		// The whole point of bestMs16: a key you once typed at goal speed is not un-taught by a bad session,
		// and a curriculum that re-taught it would stall a learner who has already moved past it.
		const first = ladder(r, {}, TARGET);
		const onceGood = atGoal(first.unlocked, 40, SLOW_MS16);
		expect(ladder(r, onceGood, TARGET).unlocked.length).toBe(first.unlocked.length + 1);
		// The same numbers with no memory of ever being good — a record written before bestMs16 existed —
		// fall back to the current mean, so an old device is not punished for its age.
		const legacy: StatMap = {};
		for (const id of first.unlocked) legacy[id] = { ttMs16: SLOW_MS16, samples: 40, errors: 0 };
		expect(ladder(r, legacy, TARGET).unlocked.length).toBe(START_SIZE);
	});

	it("names the weakest letter it has as the focus", () => {
		const first = ladder(r, {}, TARGET);
		const weakest = first.unlocked[2]!;
		// 600 ms against a 300 ms goal: half as confident as the letters beside it.
		const l = ladder(r, { ...atGoal(first.unlocked), [weakest]: { ttMs16: SLOW_MS16, bestMs16: SLOW_MS16, samples: 40, errors: 0 } }, TARGET);
		expect(l.focus).toBe(weakest);
	});

	it("puts the focus on the letter it has just handed out", () => {
		// The new letter has never been typed, so it is the weakest thing on the board, and the line the
		// generator builds is the one that has to teach it.
		const first = ladder(r, {}, TARGET);
		const l = ladder(r, atGoal(first.unlocked), TARGET);
		expect(l.focus).toBe(l.unlocked[first.unlocked.length]);
	});

	it("has no focus to fix once the whole board is at goal", () => {
		const all = teachingOrder(r, false);
		expect(ladder(r, atGoal(all), TARGET).focus).toBeUndefined();
		expect(ladder(r, {}, TARGET).focus).toBe(ladder(r, {}, TARGET).unlocked[0]); // nothing typed: first letter
	});

	it("breaks a focus tie with what is slow today", () => {
		const first = ladder(r, {}, TARGET);
		const [a, b] = first.unlocked;
		// Both have only ever run at half the goal speed. Today one of them is slower, and that is the letter
		// to build the line around.
		const half: KeyStat = { ttMs16: SLOW_MS16, bestMs16: GOAL_MS16 * 2, samples: 40, errors: 0 };
		const l = ladder(r, { ...atGoal(first.unlocked), [a!]: { ...half, ttMs16: SLOW_MS16 }, [b!]: { ...half, ttMs16: GOAL_MS16 } }, TARGET);
		expect(l.focus).toBe(a);
	});

	it("grows one letter at a time while a learner types", () => {
		let e = start({ resolved: r, targetCpm: TARGET }, {});
		let now = 1_000;
		let was = e.ladder.unlocked.length;
		let grew = 0;
		for (let i = 0; i < 900 && [...e.text][e.index] !== undefined; i += 1) {
			const res = press({ resolved: r, targetCpm: TARGET }, e, [...e.text][e.index]!, now);
			e = res.engine;
			now += 200; // inside the 300 ms goal, so keys do clear it
			const is = e.ladder.unlocked.length;
			if (is !== was) {
				expect(is - was, `letters added by one run: ${unlockedChars(e.stats).join("")}`).toBeLessThanOrEqual(1);
				grew += is - was;
				was = is;
			}
		}
		expect(grew, "the ladder should have opened at least one letter in 900 strokes").toBeGreaterThan(0);
	});
});

describe("teaching order", () => {
	it("is the corpus's own letter frequency by default", () => {
		const order = chars(teachingOrder(r, false));
		// The first six of English. If this drifts, the words the generator can build with them drift with it.
		expect(order.slice(0, 6).join("")).toBe("easrtn");
	});

	it("walks the keyboard rows first when the setting says so", () => {
		const order = chars(teachingOrder(r, true));
		const home = r.keys.filter((k) => roleOf(r.geometry, k.row) === "home").map((k) => k.char.toLowerCase());
		// Cheapest row first: the six letters a keyboard-order learner starts on are all home-row letters.
		expect(home.length).toBeGreaterThan(6);
		expect(order.slice(0, 6).every((ch) => home.includes(ch))).toBe(true);
	});
});
