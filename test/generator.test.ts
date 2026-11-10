// The line the learner sees. Two rules hold no matter which word source is switched on: nothing but the
// letters the ladder has opened, and the focused letter inside the line.
import { describe, expect, it } from "vitest";
import { GO60 } from "../src/data/go60.ts";
import { keymapById } from "../src/data/keymaps.ts";
import { resolve } from "../src/keyboard/resolve.ts";
import { lesson, type LessonInput } from "../src/lesson/generator.ts";
import { isCleanWord } from "../src/lesson/clean.ts";
import { WORDS } from "../src/lesson/corpus.ts";

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
		// Two letters the same twice in a row, or three consonants in a row, is what makes a pseudo-word
		// unreadable. Both are banned in model.ts and this is where that shows.
		expect(words.filter((w) => /(.)\1/.test(w))).toEqual([]);
		expect(words.filter((w) => /[^aeiou]{3}/.test(w))).toEqual([]);
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
