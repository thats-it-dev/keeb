// Which letter strings read as words. The tables are derived from the corpus, so the test has two jobs: the
// corpus itself has to pass (if it did not, the rules would be wrong rather than the model), and the shapes
// the model used to produce has to fail.
import { describe, expect, it } from "vitest";
import { WORDS } from "../src/lesson/corpus.ts";
import { clusters, growable, speakable, trainClusters } from "../src/lesson/phonotactics.ts";

describe("the shape of an English word", () => {
	it("holds every word the corpus teaches", () => {
		const unreadable = WORDS.filter((w) => !speakable(w));
		expect(unreadable, unreadable.slice(0, 12).join(", ")).toEqual([]);
	});

	it("refuses a consonant run no English word opens with", () => {
		// The strings this lesson used to print. Each one is a legal set of letters and an illegal way to
		// begin saying them.
		for (const w of ["tdo", "bman", "hcone", "zdial", "nsate", "xrap", "qtel"]) expect(speakable(w), w).toBe(false);
		for (const w of ["wug", "nip", "mel"]) expect(speakable(w), w).toBe(true); // the shapes a learner can sound out
	});

	it("refuses a word with no vowel in it", () => {
		for (const w of ["strn", "ngth", "shvl"]) expect(speakable(w), w).toBe(false);
	});

	it("allows a doubled letter where English doubles it", () => {
		for (const w of ["hello", "letter", "kitten", "apple", "coffee", "puppy", "grass", "odd", "ebb", "add"]) expect(speakable(w), w).toBe(true);
	});

	it("refuses a doubled letter where English does not", () => {
		// The corpus has no `ii`, `uu`, `ww`, `yy`, `kk` or `vv`, so the model may not invent them either.
		for (const w of ["biig", "muuse", "awwl", "kyy", "saate"]) expect(speakable(w), w).toBe(false);
	});

	it("knows the difference between opening a syllable and closing one", () => {
		// `mp` closes a syllable and `pr` opens the next, which is why `impret` reads and `mptre` does not.
		for (const w of ["promptly", "template", "timestamp", "bankrupt", "handbag", "impret"]) expect(speakable(w), w).toBe(true);
		for (const w of ["mptre", "ngat", "rket"]) expect(speakable(w), w).toBe(false);
	});

	it("keeps a word open while its first consonants are still arriving", () => {
		// `str` is not a word, but a model that stopped the chain there could never build `strong` or
		// `street` — and every word in the lesson would begin with a vowel.
		for (const w of ["s", "st", "str", "thr", "spr"]) expect(growable(w), w).toBe(true);
		expect(speakable("str")).toBe(false);
		for (const w of ["hcn", "td", "zxq", "mpr"]) expect(growable(w), w).toBe(false);
	});

	it("takes its tables from the words it is given", () => {
		const c = trainClusters(["star", "cling", "test"]);
		expect([...c.onset].sort().join(" ")).toBe("cl st t");
		expect([...c.coda].sort().join(" ")).toBe("ng r st");
		expect(c.vowel.size).toBe(0); // every vowel here stands alone
	});

	it("learns the vowel runs and the doubles of the corpus it was trained on", () => {
		const c = clusters();
		for (const run of ["ou", "ea", "ai", "oo"]) expect(c.vowel.has(run), run).toBe(true);
		for (const pair of ["ll", "ee", "tt", "ss"]) expect(c.double.has(pair), pair).toBe(true);
		for (const pair of ["ii", "uu", "ww", "yy"]) expect(c.double.has(pair), pair).toBe(false);
	});
});
