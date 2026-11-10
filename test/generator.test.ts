// The line the learner sees. Two rules hold no matter which word source is switched on: nothing but the
// letters the ladder has opened, and the focused letter inside the line.
import { describe, expect, it } from "vitest";
import { GO60 } from "../src/data/go60.ts";
import { keymapById } from "../src/data/keymaps.ts";
import { resolve } from "../src/keyboard/resolve.ts";
import { lesson, type LessonInput } from "../src/lesson/generator.ts";
import { isCleanWord } from "../src/lesson/clean.ts";
import { WORDS } from "../src/lesson/corpus.ts";
import { ladder, teachingOrder } from "../src/lesson/ladder.ts";
import { speakable } from "../src/lesson/phonotactics.ts";

const r = resolve(GO60, keymapById("qwerty"));
const TARGET = 200;
const START = "easrtn".split(""); // the six letters a new learner is handed

function practised(ms: number, ids: string[]) {
	const stats: LessonInput["stats"] = {};
	const q = ms * 16;
	for (const id of ids) stats[id] = { ttMs16: q, bestMs16: q, samples: 40, errors: 0 };
	return stats;
}

const idOf = (ch: string) => r.byChar.get(ch)!;
const chars = (text: string) => [...text].filter((c) => c !== " ");

function input(over: Partial<LessonInput>): LessonInput {
	return { letters: START, stats: practised(200, START.map(idOf)), targetCpm: TARGET, ids: r.byChar, realWords: false, seed: 1, ...over };
}

describe("generated words (the default)", () => {
	it("spells with nothing but the letters it was given", () => {
		const text = lesson(input({})).text;
		for (const ch of new Set(chars(text))) expect(START, ch).toContain(ch);
	});

	it("puts the focused letter in every word", () => {
		const text = lesson(input({ focus: "r" })).text;
		const words = text.split(" ");
		expect(words.length).toBeGreaterThan(5);
		expect(words.filter((w) => w.includes("r")).length).toBe(words.length);
	});

	it("makes words that could be English without claiming to be", () => {
		const words = lesson(input({})).text.split(" ");
		// Pronounceable is the claim, not English: the consonant runs and the doubled letters are the
		// corpus's own, so a word reads out loud even when no dictionary has it.
		for (const w of words) expect(speakable(w) && isCleanWord(w), w).toBe(true);
		expect(words.every((w) => /^[a-z]+$/.test(w))).toBe(true);
	});

	it("is clean", () => {
		// The rejection list lives in the generator as well as the corpus, because a made-up string can
		// spell something real by accident.
		for (const w of lesson(input({ letters: "easrtniouldchg".split(""), focus: "u" })).text.split(" ")) {
			expect(isCleanWord(w), w).toBe(true);
		}
	});

	it("repeats itself less than a word list would", () => {
		const text = lesson(input({ seed: 7 })).text;
		expect(new Set(text.split(" ")).size).toBeGreaterThan(6);
	});

	it("is the same line for the same state", () => {
		expect(lesson(input({ seed: 4 })).text).toBe(lesson(input({ seed: 4 })).text);
		expect(lesson(input({ seed: 4 })).text).not.toBe(lesson(input({ seed: 5 })).text);
	});
});

describe("real words", () => {
	it("comes out of the corpus", () => {
		const text = lesson(input({ realWords: true, letters: "asdfghjkl".split(""), focus: "s" })).text;
		const words = text.split(" ");
		expect(words.length).toBeGreaterThan(3);
		// A line may be topped up with generated words when the real pool is thin — and home-row-only English
		// is exactly that — so the honest claim is "at least half of them are in the corpus".
		expect(words.filter((w) => WORDS.includes(w)).length).toBeGreaterThanOrEqual(words.length / 2);
	});

	it("still keeps the focused letter in front of the learner", () => {
		const words = lesson(input({ realWords: true, letters: "easrtn".split(""), focus: "n" })).text.split(" ");
		expect(words.filter((w) => w.includes("n")).length).toBeGreaterThan(words.length * 0.8);
	});

	it("never shows a word the corpus would have dropped", () => {
		const words = lesson(input({ realWords: true, letters: "easrtniouldch".split(""), focus: "h" })).text.split(" ");
		for (const w of words) expect(isCleanWord(w), w).toBe(true);
	});
});

/**
 * The curriculum at a point on the ladder: a learner who has run the first `n` - 1 letters of the teaching
 * order to goal speed and has just been handed the nth. That is the state which decides what a line may
 * contain, and it is what the rules have to hold at, not only at the start.
 */
function stage(n: number, keyboardOrder = false) {
	const order = teachingOrder(r, keyboardOrder);
	const stats = practised(200, order.slice(0, n - 1));
	const l = ladder(r, stats, TARGET, { keyboardOrder });
	return {
		letters: l.unlocked.map((id) => r.byId.get(id)!.char.toLowerCase()),
		focus: l.focus === undefined ? undefined : r.byId.get(l.focus)!.char.toLowerCase(),
		stats,
	};
}

function lineAt(n: number, seed: number, over: Partial<LessonInput> & { keyboardOrder?: boolean } = {}): string {
	const s = stage(n, over.keyboardOrder ?? false);
	return lesson(input({ letters: s.letters, focus: s.focus, stats: s.stats, seed, ...over })).text;
}

const STAGES = [6, 14, 20, 26];

describe("every stage of the ladder", () => {
	it("hands out exactly the letters a stage is meant to have", () => {
		for (const n of STAGES) {
			expect(stage(n).letters.length, `${n} letters`).toBe(n);
			expect(stage(n).focus, `${n} letters has a focus`).toBeTruthy();
		}
	});

	it.each(STAGES)("puts the focused letter in every word at %i letters", (n) => {
		const focus = stage(n).focus!;
		for (let seed = 1; seed <= 12; seed += 1) {
			const words = lineAt(n, seed).split(" ");
			expect(words.length, "a line is a line").toBeGreaterThan(5);
			const missing = words.filter((w) => !w.includes(focus));
			expect(missing, `${n} letters, line ${seed}: no ${focus} in ${missing.join(", ")}`).toEqual([]);
		}
	});

	it.each(STAGES)("says nothing the learner has not unlocked at %i letters", (n) => {
		const { letters } = stage(n);
		for (let seed = 1; seed <= 12; seed += 1) {
			for (const ch of new Set(chars(lineAt(n, seed)))) expect(letters, ch).toContain(ch);
		}
	});

	it.each(STAGES)("keeps every word pronounceable at %i letters", (n) => {
		for (let seed = 1; seed <= 12; seed += 1) {
			const bad = lineAt(n, seed).split(" ").filter((w) => !speakable(w) || !isCleanWord(w));
			expect(bad, `line ${seed}: ${bad.join(", ")}`).toEqual([]);
		}
	});

	it.each(STAGES)("asks for every unlocked letter within a few lines at %i letters", (n) => {
		const { letters } = stage(n);
		const seen = new Set<string>();
		for (let seed = 1; seed <= 10; seed += 1) for (const ch of chars(lineAt(n, seed))) seen.add(ch);
		const never = letters.filter((ch) => !seen.has(ch));
		expect(never, "unasked-for letters after 10 lines").toEqual([]);
	});

	it.each(STAGES)("holds the same rules in keyboard order at %i letters", (n) => {
		const { focus } = stage(n, true);
		for (let seed = 1; seed <= 6; seed += 1) {
			for (const w of lineAt(n, seed, { keyboardOrder: true }).split(" ")) {
				expect(w, `no ${focus}`).toContain(focus!);
				expect(speakable(w) && isCleanWord(w), w).toBe(true);
			}
		}
	});

	it.each(STAGES)("keeps the focused letter in real words too at %i letters", (n) => {
		const { focus } = stage(n);
		for (let seed = 1; seed <= 6; seed += 1) {
			const words = lineAt(n, seed, { realWords: true }).split(" ");
			expect(words.length).toBeGreaterThan(5);
			for (const w of words) expect(w, `no ${focus}`).toContain(focus!);
		}
	});
});

describe("weighting", () => {
	it("leans on the key with errors", () => {
		const letters = "easrtniold".split("");
		const stats = practised(150, letters.map(idOf));
		for (let i = 0; i < 12; i += 1) stats[idOf("l")] = { ttMs16: 400 * 16, bestMs16: 400 * 16, samples: 12, errors: 8 };
		const text = lesson(input({ letters, stats, focus: "l", seed: 3 })).text;
		const share = chars(text).filter((c) => c === "l").length / chars(text).length;
		expect(share).toBeGreaterThan(0.06);
	});

	it("gives every unlocked letter a chance to appear", () => {
		const letters = "easrtnioldch".split("");
		const text = lesson(input({ letters, stats: practised(200, letters.map(idOf)), focus: "e", seed: 2 })).text;
		for (const ch of letters) expect(chars(text), ch).toContain(ch);
	});
});
