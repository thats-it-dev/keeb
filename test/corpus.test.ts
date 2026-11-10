// What may be taught. The corpus is a frequency dump of subtitles, so it carries names, interjections,
// contraction scraps and profanity; the model learns from it, so any of that would reach a lesson twice —
// once as a word, once as a pattern. These are the rules that stop it, checked against both sources.
import { describe, expect, it } from "vitest";
import { BLOCKED, droppedGerund, FILLER, FRAGMENTS, isCleanWord, SHORT_WORDS, BLOCKED_ROOTS } from "../src/lesson/clean.ts";
import { WORDS } from "../src/lesson/corpus.ts";
import { frequencyOrder, model, readable, word } from "../src/lesson/model.ts";

const ALL = new Set(WORDS);
const letters = (s: string) => new Set([...s]);

// A deterministic source: 0.5 everywhere picks the middle of each distribution.
const middle = () => 0.5;

describe("the corpus as generated", () => {
	it("holds no word the rules reject", () => {
		const dirty = WORDS.filter((w) => !isCleanWord(w));
		expect(dirty, dirty.slice(0, 10).join(", ")).toEqual([]);
	});

	it("holds no name and no contraction fragment", () => {
		// The dump's proper nouns are rejected by a build-time list (scripts/blocklists.ts) that never ships,
		// so the check is that none of those strings survived into the data.
		const fragments = WORDS.filter((w) => FRAGMENTS.has(w) || FILLER.has(w) || BLOCKED.has(w));
		expect(fragments, fragments.slice(0, 10).join(", ")).toEqual([]);
	});

	it("holds no g-dropped gerund", () => {
		const dropped = WORDS.filter((w) => droppedGerund(w, ALL));
		expect(dropped, dropped.slice(0, 10).join(", ")).toEqual([]);
		// And the rule is not firing on words that merely end in "in": the full form must exist to condemn it.
		expect(droppedGerund("plan", ALL)).toBe(false);
	});

	it("is sorted by frequency, which is what makes the first six letters the useful six", () => {
		expect(frequencyOrder(WORDS).join("").slice(0, 6)).toBe("easrtn");
		expect(WORDS.length).toBeGreaterThanOrEqual(3000);
	});

	it("keeps a letter broad enough to teach every one of them", () => {
		for (const ch of "abcdefghijklmnopqrstuvwxyz") {
			expect(WORDS.filter((w) => w.includes(ch)).length, ch).toBeGreaterThan(15);
		}
	});
});

describe("the rules themselves", () => {
	it("rejects profanity by root and by whole word", () => {
		for (const w of ["fuck", "fucked", "shit", "bullshit", "arse"]) expect(isCleanWord(w), w).toBe(false);
		for (const root of BLOCKED_ROOTS) expect(isCleanWord(`un${root}ly`), root).toBe(false);
	});

	it("does not reject honest vocabulary that happens to contain a rude substring", () => {
		for (const w of ["class", "classic", "peacock", "cumulative", "scrap", "title", "grape", "attention"]) {
			expect(isCleanWord(w), w).toBe(true);
		}
	});

	it("rejects interjections and keeps the two-letter words that are real", () => {
		for (const w of ["oh", "ah", "hmm", "wow", "ok", "yeah", "ugh"]) expect(isCleanWord(w), w).toBe(false);
		for (const w of ["an", "as", "at", "by", "of", "to", "up"]) expect(isCleanWord(w), w).toBe(true);
		expect(SHORT_WORDS.size).toBeGreaterThan(20);
	});

	it("rejects fragments that read like words", () => {
		for (const w of ["dont", "youre", "ive", "wanna", "kinda", "gonna"]) expect(isCleanWord(w), w).toBe(false);
	});

	it("rejects anything a keyboard leaned on", () => {
		for (const w of ["cafe", "naive"]) expect(isCleanWord(w), w).toBe(true); // letters, accents not required
		expect(isCleanWord("don't")).toBe(false);
		expect(isCleanWord("u")).toBe(false);
		expect(isCleanWord("rn")).toBe(false); // no vowel: a fragment of a tokenised name
	});
});

describe("the word model", () => {
	const m = model();

	it("invents nothing offensive", () => {
		// The reason rejection lives in the generator: a model trained on clean data still spells dirty words
		// by accident, because it stores letter patterns and not intentions.
		const allowed = letters("easrtniouldchg");
		const made = Array.from({ length: 2000 }, () => word(m, allowed, undefined, Math.random));
		const dirty = made.filter((w) => !isCleanWord(w));
		expect(dirty, [...new Set(dirty)].slice(0, 10).join(", ")).toEqual([]);
	});

	it("uses only the letters it was given", () => {
		const allowed = letters("easrtn");
		for (const w of Array.from({ length: 400 }, () => word(m, allowed, "r", Math.random))) {
			for (const ch of w) expect([...allowed], ch).toContain(ch);
		}
	});

	it("puts the focus in the word", () => {
		const allowed = letters("easrtniold");
		for (const focus of ["e", "a", "s", "r", "t", "n", "i", "o", "l", "d"]) {
			const w = word(m, allowed, focus, middle);
			expect(w, focus).toContain(focus);
		}
	});

	it("makes something a hand can read", () => {
		// No doubled letters, no three consonants: what "pronounceable" means here, and the reason the
		// output is not a scamble of the allowed set.
		expect(readable("rate")).toBe(true);
		expect(readable("raate")).toBe(false);
		expect(readable("strn")).toBe(false);
		const allowed = letters("easrtniouldch");
		for (const w of Array.from({ length: 500 }, () => word(m, allowed, "c", Math.random))) {
			expect(/(.)\1/.test(w), w).toBe(false);
			expect(/[^aeiou]{3}/.test(w), w).toBe(false);
		}
	});

	it("is not a fixed list", () => {
		const allowed = letters("easrtniouldchg");
		const made = new Set(Array.from({ length: 300 }, () => word(m, allowed, "g", Math.random)));
		// Six letters of real English is a shelf of about four words, which is the whole reason the default
		// source is the model. Ten times that, from the same ten letters, is the floor for "not a list".
		expect(made.size).toBeGreaterThan(40);
	});
});
