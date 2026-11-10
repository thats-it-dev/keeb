// What makes a letter string read as a word rather than a scamble. The n-gram model knows which letter
// follows which, one letter at a time; it has no idea that `h` and `c` never open an English word, or that
// a word may double its `l` but never its `i`. This file is that missing knowledge, and it is derived from
// the same corpus the model trains on rather than hand-listed: every cluster below is one some real English
// word in `corpus.ts` actually has, so the rules cannot drift away from the vocabulary.
//
// The model walks a word one letter at a time, so there are two questions to answer about a string:
// `speakable` — may this stand as a finished word — and `growable` — may a finished word ever come from this
// by adding letters. A half-built consonant run is where they disagree: `str` is not a word, but it is the
// beginning of one.

import { WORDS } from "./corpus.ts";

const VOWELS = "aeiouy";
const isVowel = (ch: string) => VOWELS.includes(ch);
const hasVowel = (word: string) => [...word].some(isVowel);

export type Clusters = {
	/** Consonant runs that open a syllable, from the start of corpus words. */
	onset: Set<string>;
	/** Prefixes of those, so a run that is still growing is not cut off before it can finish. */
	onsetStart: Set<string>;
	/** Consonant runs that close a syllable, from the end of corpus words. */
	coda: Set<string>;
	/** Vowel runs of two letters or more. A single vowel is always welcome. */
	vowel: Set<string>;
	/** Letters English doubles: `ll`, `ee`, `tt` — and not `ii`, `uu`, `ww`. */
	double: Set<string>;
};

let cached: Clusters | undefined;

/** The clusters of the shipped corpus, memoised: 4 000 words of slicing, once. */
export function clusters(): Clusters {
	cached ??= trainClusters(WORDS);
	return cached;
}

export function trainClusters(words: readonly string[]): Clusters {
	const c: Clusters = { onset: new Set(), onsetStart: new Set(), coda: new Set(), vowel: new Set(), double: new Set() };
	for (const w of words) {
		const parts = runs(w);
		parts.forEach((run, i) => {
			if (isVowel(run[0]!)) {
				if (run.length > 1) c.vowel.add(run);
			} else if (i === 0) {
				c.onset.add(run);
				for (let k = 1; k < run.length; k += 1) c.onsetStart.add(run.slice(0, k));
			} else {
				c.coda.add(run);
				// A medial coda is also the first half of a two-syllable cluster: `-mp` + `-pt`.
				if (i < parts.length - 1) for (let k = 1; k < run.length; k += 1) c.onsetStart.add(run.slice(k));
			}
		});
		for (const m of w.match(/(.)\1/g) ?? []) c.double.add(m);
	}
	return c;
}

/** The maximal same-kind runs of a word, alternating consonants and vowels. */
function runs(word: string): string[] {
	const out: string[] = [];
	let start = 0;
	for (let i = 1; i <= word.length; i += 1) {
		if (i === word.length || isVowel(word[i]!) !== isVowel(word[i - 1]!)) {
			out.push(word.slice(start, i));
			start = i;
		}
	}
	return out;
}

/** May this string stand as a finished word? */
export function speakable(word: string): boolean {
	return legal(word, false);
}

/** May adding letters to this string ever produce a finished word? */
export function growable(word: string): boolean {
	return legal(word, true);
}

function legal(word: string, partial: boolean): boolean {
	if (word === "") return true;
	if (!/^[a-z]+$/.test(word)) return false;
	const c = clusters();
	// A doubled letter is English's to allow or refuse, and the corpus is what says which.
	for (let i = 1; i < word.length; i += 1) {
		if (word[i] === word[i - 1] && !c.double.has(word.slice(i - 1, i + 1))) return false;
	}
	if (!hasVowel(word) && !partial) return false;
	const parts = runs(word);
	for (let i = 0; i < parts.length; i += 1) {
		const run = parts[i]!;
		if (isVowel(run[0]!)) {
			if (run.length > 1 && !c.vowel.has(run)) return false;
			continue;
		}
		const last = i === parts.length - 1;
		// Only the run a word ends on is still allowed to be half-built.
		if (!partial || !last) {
			const ok = i === 0 ? c.onset.has(run) : last ? c.coda.has(run) : splits(run, c);
			if (!ok) return false;
			continue;
		}
		if (parts.length === 1) {
			// No vowel yet, so this run can only be the start of one syllable.
			if (!c.onset.has(run) && !c.onsetStart.has(run)) return false;
			continue;
		}
		// Between two vowels and still growing: some part of it closes the last syllable, the rest opens
		// the next one, and the opener may not be finished yet.
		let ok = false;
		for (let cut = 1; cut <= run.length && !ok; cut += 1) {
			const head = run.slice(0, cut);
			const tail = run.slice(cut);
			if (!(c.coda.has(head) || splits(head, c))) continue;
			ok = tail === "" || c.onset.has(tail) || c.onsetStart.has(tail);
		}
		if (!ok) return false;
	}
	return true;
}

/** May a consonant run between two vowels be split into one syllable closing and the next opening? */
function splits(run: string, c: Clusters): boolean {
	// One letter between two vowels belongs to whichever syllable you like: it is an onset in `very` and a
	// coda in `have`.
	if (run.length === 1) return c.coda.has(run) || c.onset.has(run);
	for (let cut = 1; cut < run.length; cut += 1) {
		if (c.coda.has(run.slice(0, cut)) && (c.onset.has(run.slice(cut)) || c.onsetStart.has(run.slice(cut)))) return true;
	}
	return false;
}
