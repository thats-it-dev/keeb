// A letter n-gram model over our own corpus, and the letter order that falls out of it. This is what lets
// a lesson use six letters without running out of words: the model produces the *shape* of English words
// — consonant, vowel, blend — while the letters it may use are exactly the ones the learner has unlocked.
//
// Order 3 (the last two symbols predict the next) rather than the longer contexts a 10 000-word dictionary
// can support: at 4 000 words a longer context is usually empty, and an empty context here means a letter
// that cannot be typed at all. Unknown contexts back off to the shorter one, then to plain frequency.
//
// Two things keep the output readable. A word starts from the beginning of a real corpus word (the prefix
// list), so the first two or three letters are ones English actually opens a word with; and every letter
// added afterwards has to leave the string able to grow into a speakable word (phonotactics.ts).

import { isCleanWord } from "./clean.ts";
import { WORDS } from "./corpus.ts";
import { growable, speakable } from "./phonotactics.ts";

/** A random source, injected so a lesson can be reproduced in a test. */
export type Rng = () => number;

/** A word is at least this long, so the learner is typing words and not beeps. */
export const MIN_WORD = 3;
/** ...and never longer, because a long word on six keys is a repetition of the same three strokes. */
export const MAX_WORD = 9;
/** How many letters of a real word a generated one starts from. */
const PREFIX = 3;
/** How many starts one word tries before giving up on it. */
const ATTEMPTS = 12;

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
	/** the opening letters of real words, longest first, so a word can start like one. */
	prefix: Map<string, number>;
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
	const m: Mutable = { next: new Map(), any: new Map(), letters: new Map(), prefix: new Map() };
	words.forEach((word, rank) => {
		const weight = 1 / (1 + rank / RANK_HALF);
		for (const ch of word) m.letters.set(ch, (m.letters.get(ch) ?? 0) + weight);
		// A word starts after two boundaries and ends after one. keybr pads the left the same way, which is
		// what keeps the first letter of a generated word English rather than a roll of the whole alphabet.
		trainWord(m, [EDGE, EDGE, ...word, EDGE], weight);
		for (let n = 1; n <= PREFIX && n <= word.length; n += 1) {
			const head = word.slice(0, n);
			m.prefix.set(head, (m.prefix.get(head) ?? 0) + weight);
		}
	});
	const order = [...m.letters.entries()]
		.sort((a, b) => b[1] - a[1] || (a[0]! < b[0]! ? -1 : 1))
		.map(([ch]) => ch);
	return { order, next: m.next, any: m.any, prefix: m.prefix };
}

type Mutable = { next: Map<string, Map<string, number>>; any: Map<string, number>; letters: Map<string, number>; prefix: Map<string, number> };

/** The distribution that follows a chain of up to two symbols, longest context first. */
function following(m: Model, chain: string): Map<string, number> {
	const ctx = (START + chain).slice(-2);
	const one = ctx.slice(-1);
	return m.next.get(ctx) ?? m.next.get(EDGE + one) ?? m.any;
}

/**
 * One word of pseudo-English built from `allowed`. Every letter of `need` goes inside it, in this order of
 * firmness: the first is required, the rest are asked for and may wait for the next line if this one's
 * letters cannot share a word.
 *
 * The required letters come from the prefix list — the opening of a real word that already contains them.
 * Where a letter belongs inside a word is the model's business, not ours: a letter dropped into a slot
 * picked at random lands on the wrong side of a cluster and reads as noise.
 */
export function word(m: Model, allowed: Set<string>, need: string[], rng: Rng): string {
	const wanted = need.filter((ch) => allowed.has(ch));
	let held = "";
	for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
		// Half the attempts reach for every letter the line asked for; the rest settle for the first one,
		// because two rare letters can sit in a letter set that no short word spells with both.
		const target = attempt < ATTEMPTS / 2 ? wanted : wanted.slice(0, 1);
		const start = seed(m, allowed, target, rng);
		if (start === undefined) continue;
		const chain = grow(m, allowed, start, rng);
		if (chain.length < MIN_WORD || !isCleanWord(chain) || !speakable(chain)) continue;
		if (wanted.every((ch) => chain.includes(ch))) return chain;
		if (held === "") held = chain; // it carries the first letter, which is the one the line is about
	}
	if (wanted.length > 0 && held === "") held = wanted[0]!; // a single key is still the drill the lesson asked for
	return held;
}

/** How a word begins: the longest slice of a real word that the unlocked letters can spell. */
function seed(m: Model, allowed: Set<string>, need: string[], rng: Rng): string | undefined {
	let best: [string, number][] = [];
	let covered = -1;
	for (const [prefix, weight] of m.prefix) {
		if (!prefixHas(prefix, allowed)) continue;
		const hits = need.filter((ch) => prefix.includes(ch)).length;
		if (hits > covered) {
			covered = hits;
			best = [[prefix, weight]];
		} else if (hits === covered) best.push([prefix, weight]);
	}
	if (best.length === 0) return undefined;
	let out = draw(best, rng);
	for (const ch of need) {
		if (out.includes(ch)) continue;
		const slots = Array.from({ length: out.length + 1 }, (_, i) => i).filter((i) => growable(out.slice(0, i) + ch + out.slice(i)));
		if (slots.length === 0) return undefined;
		const at = slots[Math.floor(rng() * slots.length)]!;
		out = out.slice(0, at) + ch + out.slice(at);
	}
	return out;
}

/** A prefix is usable when every letter of it is unlocked and it is not a word the lesson must not show. */
function prefixHas(prefix: string, allowed: Set<string>): boolean {
	if (![...prefix].every((ch) => allowed.has(ch))) return false;
	if (prefix.length >= MIN_WORD && !isCleanWord(prefix)) return false;
	return growable(prefix);
}

/** Extend a start until the model stops, the word reaches MAX_WORD, or nowhere legal is left to go. */
function grow(m: Model, allowed: Set<string>, chain: string, rng: Rng): string {
	let out = chain;
	for (let step = 0; step < MAX_WORD; step += 1) {
		const row = following(m, out);
		let options = legal(row, allowed, out);
		// A context that offers nothing this learner can type is as useless as one the corpus never showed:
		// back off to plain letter frequency instead of abandoning a word two letters in.
		if (options.length === 0) options = legal(m.any, allowed, out);
		// A word may only end where it already reads as one, and it is likelier to stop the longer it gets.
		const end = out.length >= MIN_WORD && speakable(out) ? (row.get(EDGE) ?? 0) * Math.pow(1.35, out.length - MIN_WORD) : 0;
		const symbol = pick([...options, [EDGE, end] as [string, number]], rng);
		if (symbol === undefined || symbol === EDGE) break;
		out += symbol;
		if (out.length >= MAX_WORD) break;
	}
	return out;
}

/** The symbols of a distribution that are unlocked and leave the word able to grow. */
function legal(row: Map<string, number>, allowed: Set<string>, chain: string): [string, number][] {
	const out: [string, number][] = [];
	for (const [symbol, weight] of row) {
		if (symbol === EDGE) continue;
		if (allowed.has(symbol) && growable(chain + symbol)) out.push([symbol, weight]);
	}
	return out;
}

/** Pick one symbol out of a weighted list. */
function pick(options: [string, number][], rng: Rng): string | undefined {
	const sum = options.reduce((acc, [, w]) => acc + w, 0);
	if (sum <= 0) return undefined;
	let r = rng() * sum;
	for (const [symbol, w] of options) {
		r -= w;
		if (r <= 0) return symbol;
	}
	return options[options.length - 1]?.[0];
}

/** A weighted draw, with a little jitter so a rare prefix in the same tier as a common one still gets used. */
function draw(options: [string, number][], rng: Rng): string {
	return pick(options.map(([key, weight]) => [key, weight * (0.5 + rng())] as [string, number]), rng) ?? options[0]![0];
}

/**
 * Which letters come first: by how often the language uses them, weighted so the words a learner will
 * actually meet count for more than the ones in the tail. Ties go alphabetically, so the order is stable
 * across runs and machines.
 */
export function frequencyOrder(words: readonly string[] = WORDS): string[] {
	return train(words).order;
}
