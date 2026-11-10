// The engine: keystrokes in, progress and the next line out. What it owes the screens is a `focus` to
// highlight and a line that only ever contains letters the ladder opened.
import { describe, expect, it } from "vitest";
import { GO60 } from "../src/data/go60.ts";
import { keymapById } from "../src/data/keymaps.ts";
import { resolve } from "../src/keyboard/resolve.ts";
import { press, start, type Course, type Engine } from "../src/lesson/engine.ts";
import { WORDS } from "../src/lesson/corpus.ts";
import { isCleanWord } from "../src/lesson/clean.ts";
import { teachingOrder } from "../src/lesson/ladder.ts";
import { speakable } from "../src/lesson/phonotactics.ts";
import { emptyStat, timeToTypeMs, type StatMap } from "../src/stats/stats.ts";

const r = resolve(GO60, keymapById("qwerty"));
const TARGET = 200; // cpm, a 300ms-per-character goal
const course: Course = { resolved: r, targetCpm: TARGET };

// A fake typist with a fixed speed per character, so a slow key should show up as drilled more.
const SPEED: Record<string, number> = { s: 90, t: 95, a: 110, r: 130, n: 140, e: 120, i: 260, o: 150, g: 170, m: 240 };

function typeRun(e: Engine, from = 1000, ms = 220) {
	let engine = e;
	let now = from;
	let mistakes = 0;
	for (let guard = 0; guard < 20000; guard += 1) {
		const want = [...engine.text][engine.index];
		if (want === undefined) break;
		const wrong = guard % 41 === 40 && mistakes < 6;
		if (wrong) mistakes += 1;
		const res = press(course, engine, wrong ? "z" : want, now);
		engine = res.engine;
		if (res.finished) break;
		now += SPEED[want] ?? ms;
	}
	return { engine, now, mistakes };
}

const typedStats = (): StatMap => {
	const stats: StatMap = {};
	for (const [ch, ms] of Object.entries(SPEED)) {
		const id = r.byChar.get(ch);
		if (id) stats[id] = { ttMs16: ms * 16, bestMs16: ms * 16, samples: 40, errors: 0 };
	}
	return stats;
};

describe("lesson engine", () => {
	it("starts a brand new learner on six letters of made-up words", () => {
		const e = start(course, {});
		expect(e.pending).not.toBe("");
		expect(e.ladder.unlocked.length).toBe(6);
		const words = e.text.split(" ");
		expect(words.length).toBeGreaterThan(6);
		expect(words.every((w) => /^[a-z]+$/.test(w))).toBe(true);
		expect(words.filter((w) => w.length > 1).length).toBeGreaterThan(4);
		// The default is the model, not the dictionary: with six letters the corpus can only spell a shelf of
		// about four words, and repeating them is not practice. Some of what the model makes will still be real
		// — "rate" is six letters of English — so the claim is that the line is not a word list.
		expect(words.some((w) => !WORDS.includes(w))).toBe(true);
	});

	it("records one sample per keystroke and one error per mistake", () => {
		const e = start(course, {});
		const ok = press(course, e, [...e.text][e.index]!, 5000);
		expect(ok.accepted).toBe(true);
		expect(ok.engine.stats[ok.targetId]?.samples).toBe(1);
		const bad = press(course, ok.engine, "z", 6000);
		expect(bad.accepted).toBe(false);
		expect(bad.engine.index).toBe(ok.engine.index);
		expect((bad.engine.stats[bad.targetId] ?? emptyStat()).errors).toBeGreaterThanOrEqual(1);
	});

	// The keyboard lights what the fingers hit; the statistics still blame the key being drilled.
	it("separates the key pressed from the key wanted", () => {
		const e = start(course, {});
		const want = [...e.text][e.index]!;
		const straight = press(course, e, want, 5000);
		expect(straight.pressedId).toBe(straight.targetId);
		const other = want === "q" ? "z" : "q";
		const slip = press(course, e, other, 5000);
		expect(slip.pressedId).toBe(r.byChar.get(other));
		expect(slip.pressedId).not.toBe(slip.targetId);
		expect(slip.targetId).toBe(e.pending);
	});

	it("measures the slow key as slow", () => {
		const e = start(course, typedStats());
		expect(timeToTypeMs(e.stats[r.byChar.get("m")!])).toBe(240);
		expect(timeToTypeMs(e.stats[r.byChar.get("s")!])).toBe(90);
	});

	it("never asks for a character the ladder has not opened", () => {
		const { engine } = typeRun(start(course, {}));
		const unlocked = new Set(engine.ladder.unlocked.map((id) => r.byId.get(id)?.char.toLowerCase()));
		for (const ch of new Set([...engine.text])) {
			if (ch === " ") continue;
			expect(unlocked.has(ch), ch).toBe(true);
		}
	});

	it("carries the focused letter in the line it places", () => {
		// The screen rings one key and the line is built around it. If these two ever disagree, the ring is
		// decoration, so this reads the focus off the engine's own ladder and checks the text against it.
		const e = start(course, typedStats());
		const focus = e.ladder.focus === undefined ? undefined : r.byId.get(e.ladder.focus)?.char.toLowerCase();
		expect(focus).toBeTruthy();
		for (const w of e.text.split(" ")) expect(w, `word ${w} lacks focus ${focus}`).toContain(focus!);
	});

	it("carries the focused letter through every line as the ladder grows", () => {
		// The bug this pins: a line that patched an unexercised letter in replaced whole words with words
		// built around that letter alone, so past a dozen letters half of them stopped carrying the focus.
		// Only typing catches it, because the curriculum moves as the keys get faster.
		const stats: StatMap = {};
		for (const id of teachingOrder(r, false).slice(0, 13)) stats[id] = { ttMs16: 3200, bestMs16: 3200, samples: 40, errors: 0 };
		let e = start(course, stats);
		let now = 1000;
		for (let line = 0; line < 10; line += 1) {
			const focus = e.ladder.focus === undefined ? undefined : r.byId.get(e.ladder.focus)?.char.toLowerCase();
			const words = e.text.split(" ");
			expect(words.length, `line ${line} is a line`).toBeGreaterThan(5);
			for (const w of words) {
				if (focus !== undefined) expect(w, `line ${line}: no ${focus} in ${w}`).toContain(focus);
				expect(speakable(w) && isCleanWord(w), `line ${line}: ${w}`).toBe(true);
			}
			({ engine: e, now } = typeRun(e, now));
		}
	});

	it("keeps the corpus broad enough for every letter", () => {
		for (const ch of "abcdefghijklmnopqrstuvwxyz") {
			expect(WORDS.filter((w) => w.includes(ch)).length, ch).toBeGreaterThan(15);
		}
	});

	it("does not credit the first keystroke of a run with infinite speed", () => {
		// The bug this pins: press() sets stamp to 0 at a run boundary so the pause between runs is never
		// charged to a key -- correct intent, wrong consequence. elapsedMs came out as 0, and 0 went into the
		// EWMA as a measurement of "instantly". A key that happened to START a line came out at 429 wpm while
		// every other row sat near 230ms, and the screen's average read faster than every key inside it.
		const e = start(course, {});
		const res = press(course, e, [...e.text][0]!, 5000);
		const stat = res.engine.stats[res.targetId]!;
		expect(stat.samples).toBe(1); // the stroke happened, so it counts as a character typed
		expect(stat.ttMs16).toBe(0); // but nothing was measured, so the mean has no observation in it
		expect(timeToTypeMs(stat)).toBe(0); // which reads as "unknown", not as "0ms"
		// And the next stroke, which DOES have an earlier stroke to measure against, is timed properly.
		const want2 = [...res.engine.text][res.engine.index]!;
		const second = press(course, res.engine, want2, 5200);
		expect(second.engine.stats[second.targetId]!.ttMs16).toBe(200 * 16);
	});

	it("remembers the fastest a key has ever run", () => {
		// Best, not current: a key that touched goal speed once and then went slow must still count as taught,
		// or the curriculum re-teaches a letter the learner has already passed.
		const e = start(course, {});
		const fast = press(course, e, [...e.text][0]!, 5000);
		const want2 = [...fast.engine.text][fast.engine.index]!;
		const after = press(course, fast.engine, want2, 5000 + 60_000); // a pause, filed at its ceiling
		const id = after.engine.stats[after.targetId] ? after.targetId : fast.targetId;
		expect(after.engine.stats[id]!.bestMs16).toBeLessThanOrEqual(after.engine.stats[id]!.ttMs16);
	});

	it("keeps an average from coming out faster than every key it averages", () => {
		// Michael's report was exactly this: the headline said 59 wpm, the rows said 51-53. An untimed
		// keystroke at a run boundary dragged one key's mean toward zero, and the mean of means followed it.
		let engine = start(course, {});
		let now = 1000;
		for (let i = 0; i < 400 && [...engine.text][engine.index] !== undefined; i += 1) {
			engine = press(course, engine, [...engine.text][engine.index]!, now).engine;
			now += 230; // a fixed, machine-honest cadence
		}
		const rows = Object.values(engine.stats).filter((s) => timeToTypeMs(s) > 0);
		expect(rows.length).toBeGreaterThan(3);
		expect(Math.min(...rows.map((s) => timeToTypeMs(s)))).toBeGreaterThanOrEqual(200);
		expect(Math.max(...rows.map((s) => timeToTypeMs(s)))).toBeLessThan(600);
	});

	it("restarts the curriculum on a settings change, not on a keystroke", () => {
		// realWords is a course property: the same state must produce a different line when it flips.
		const asGenerated = start({ ...course, realWords: false }, typedStats()).text;
		const asReal = start({ ...course, realWords: true }, typedStats()).text;
		expect(asGenerated).not.toBe(asReal);
		expect(asReal.split(" ").some((w) => WORDS.includes(w))).toBe(true);
	});
});
