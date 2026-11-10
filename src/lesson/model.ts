// A letter n-gram model over our own corpus, and the letter order that falls out of it. This is what lets
// a lesson use six letters without running out of words: the model produces the *shape* of English words
// — consonant, vowel, blend — while the letters it may use are exactly the ones the learner has unlocked.
//
// Order 3 (the last two symbols predict the next) rather than the longer contexts a 10 000-word dictionary
// can support: at 4 000 words a longer context is usually empty, and an empty context here means a letter
// that cannot be typed at all. Unknown contexts back off to the shorter one, then to plain frequency.

import { isCleanWord } from "./clean.ts";
import { WORDS } from "./corpus.ts";

/** A random source, injected so a lesson can be reproduced in a test. */
export type Rng = () => number;

/** A word is at least this long, so the learner is typing words and not beeps. */
export const MIN_WORD = 3;
/** ...and never longer, because a long word on six keys is a repetition of the same three strokes. */
export const MAX_WORD = 9;

/** Rank decay: the corpus is a frequency list, so a word at rank n votes for its letters with weight
 *  1 / (1 + n / RANK_HALF) instead of a full vote. Without the decay the 3 000 rare words in the tail
 *  outvote the 100 words the learner is actually going to type. */
const RANK_HALF = 400;

/** The symbol that is not a letter: it stands for the start and the end of a word. */
const EDGE = " ";

export type Model = {
	/** Every letter the corpus contains, most frequent first. */
	order: string[];
	/** context (two symbols) -> next symbol -> weight. */
	next: Map<string, Map<string, number>>;
	/** symbol -> weight, for contexts the corpus never shows. */
	any: Map<string, number>;
};

let cached: Model | undefined;

/** Train on the shipped corpus. Memoised: it is 4 000 words of pure counting, and every keystroke that
 *  rebuilds a lesson would otherwise pay for it again. */
export function model(): Model {
	cached ??= train(WORDS);
	return cached;
}

/** Train on a word list: `chain` is one word with its boundaries, `weight` how much it votes. */
function trainWord(m: Mutable, chain: string[], weight: number): void {
	for (let i = 0; i + 2 < chain.length; i += 1) {
		const ctx = chain[i] + chain[i + 1];
		const target = chain[i + 2];
		let row = m.next.get(ctx);
		if (!row) m.next.set(ctx, (row = new Map()));
		row.set(target, (row.get(target) ?? 0) + weight);
		m.any.set(target, (m.any.get(target) ?? 0) + weight);
	}
}

/** Two boundary symbols, so the very first letter of a word has a context to be sampled from. */
const START = EDGE + EDGE;

export function train(words: readonly string[]): Model {
	const m: Mutable = { next: new Map(), any: new Map(), letters: new Map() };
	words.forEach((word, rank) => {
		const weight = 1 / (1 + rank / RANK_HALF);
		for (const ch of word) m.letters.set(ch, (m.letters.get(ch) ?? 0) + weight);
		// A word starts after two boundaries and ends after one. keybr pads the left the same way, which is
		// what keeps the first letter of a generated word English rather than a roll of the whole alphabet.
		trainWord(m, [EDGE, EDGE, ...word, EDGE], weight);
	});
	const order = [...m.letters.entries()]
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
		.map(([ch]) => ch);
	return { order, next: m.next, any: m.any };
}

type Mutable = { next: Map<string, Map<string, number>>; any: Map<string, number>; letters: Map<string, number> };

/** The distribution that follows a chain of up to two symbols, longest context first. */
function following(m: Model, chain: string): Map<string, number> {
	const ctx = (START + chain).slice(-2);
	const one = ctx.slice(-1);
	return m.next.get(ctx) ?? m.next.get(EDGE + one) ?? m.any;
}

/**
 * Pick one symbol out of a weighted map. `allowed` gates the letters, `end` is the weight of the word
 * boundary (0 forbids stopping), and `legal` has the last say: a model trained on 4 000 words will happily
/** Pick one symbol out of a weighted map, keeping the letters in `allowed`, the boundary at weight `end`,
 * and only the continuations that stay readable. */
function pick(row: Map<string, number>, allowed: Set<string>, end: number, rng: Rng, soFar: string): string | undefined {
	const parts: [string, number][] = [];
	for (const [symbol, weight] of row) {
		if (symbol === EDGE) {
			if (end > 0) parts.push([symbol, end]);
			continue;
		}
		if (!allowed.has(symbol) || !readable(soFar + symbol)) continue;
		parts.push([symbol, weight]);
	}
	const sum = parts.reduce((acc, [, w]) => acc + w, 0);
	if (sum <= 0) return undefined;
	let r = rng() * sum;
	for (const [symbol, w] of parts) {
		r -= w;
		if (r <= 0) return symbol;
	}
	return parts[parts.length - 1][0];
}


/**
 * What makes a letter string readable rather than merely possible: no letter doubles, and never three
 * consonants in a row. Both are whole-word rules, because a focused letter dropped into the middle of a
 * seed can break them on either side of where it lands.
 */
export function readable(word: string): boolean {
	return !/(.)\1/.test(word) && !/[^aeiouy]{3}/.test(word);
}

/**
 * One word of pseudo-English built from `allowed`, and containing `focus` when one is given.
 *
 * The focused letter is placed in the seed rather than enforced by rejection: rejecting every word that
 * misses it would spend the attempts on a coin flip, and the letter would still land in one of two or
 * three positions. Where it lands is the model's business, not ours.
 */
export function word(m: Model, allowed: Set<string>, focus: string | undefined, rng: Rng): string {
	for (let attempt = 0; attempt < 12; attempt += 1) {
		const seeded = seed(m, allowed, focus, rng);
		if (seeded === undefined) continue;
		let chain = seeded;
		for (let step = 0; step < MAX_WORD; step += 1) {
			const row = following(m, chain);
			// A word is likelier to stop the longer it gets, scaled by how often this context stops one at all.
			const end = (row.get(EDGE) ?? 0) * Math.pow(1.35, chain.length - MIN_WORD);
			const symbol = pick(row, allowed, chain.length < MIN_WORD ? 0 : end, rng, chain);
			if (symbol === undefined || symbol === EDGE) break;
			chain += symbol;
			if (chain.length >= MAX_WORD) break;
		}
		if (chain.length >= MIN_WORD && isCleanWord(chain)) return chain;
	}
	return focus ?? "";
}

/** A one or two letter start taken from the model, with the focused letter dropped into it. */
function seed(m: Model, allowed: Set<string>, focus: string | undefined, rng: Rng): string | undefined {
	let out = "";
	const extra = 1 + Math.floor(rng() * 2);
	for (let i = 0; i < extra; i += 1) {
		const symbol = pick(following(m, out), allowed, 0, rng, out);
		if (symbol === undefined || symbol === EDGE) break;
		out += symbol;
	}
	if (focus === undefined) return out === "" ? undefined : out;
	if (out === "") return focus;
	// Only the slots where the focused letter does not spoil the word: "ate" with a second "t" shoved in
	// front of the last one is "atte", and a learner reads that as a fault in the lesson, not in themselves.
	const slots = Array.from({ length: out.length + 1 }, (_, i) => i).filter((i) => readable(out.slice(0, i) + focus + out.slice(i)));
	// Nowhere to put it: this attempt is a dud, and the loop will have tried a different seed by the time
	// the word is three letters long.
	if (slots.length === 0) return undefined;
	const at = slots[Math.floor(rng() * slots.length)]!;
	return out.slice(0, at) + focus + out.slice(at);
}

/**
 * Which letters come first: by how often the language uses them, weighted so the words a learner will
 * actually meet count for more than the ones in the tail. Ties go alphabetically, so the order is stable
 * across runs and machines.
 */
export function frequencyOrder(words: readonly string[] = WORDS): string[] {
	return train(words).order;
}
