import type { StatMap } from "../stats/stats.ts";
import { confidence, errorRate } from "../stats/stats.ts";
import { WORDS } from "./corpus.ts";

export type Lesson = {
	// Characters the learner may be asked for, in teaching order.
	letters: string[];
	text: string;
};

// char -> key id, from Resolved.byChar. Stats are stored by key id and the corpus is by character,
// so the generator needs this mapping to look a character's stats up.
export type CharIds = Map<string, string>;

const WORDS_PER_LINE = 12;
const POOL = 400; // corpus rank window: the 400 most frequent typeable words
const FREQ_DECAY = 0.012; // weight of a word at rank n falls as 1 / (1 + n * FREQ_DECAY)

export function lesson(letters: string[], stats: StatMap, targetCpm: number, ids: CharIds, words = WORDS_PER_LINE): Lesson {
	const allowed = new Set([...letters, " "]); // words are separated by the space key, always allowed
	const pool: { word: string; rank: number }[] = [];
	for (let rank = 0; rank < WORDS.length && pool.length < POOL; rank += 1) {
		if (usable(WORDS[rank], allowed)) pool.push({ word: WORDS[rank], rank });
	}
	if (pool.length === 0) return { letters: [...allowed], text: tapOnly([...allowed], words) };
	const out: string[] = [];
	for (let i = 0; i < words; i += 1) out.push(pick(pool, stats, targetCpm, ids, i));
	return { letters: [...allowed], text: out.join(" ") };
}

function usable(word: string, allowed: Set<string>): boolean {
	for (const ch of word) if (!allowed.has(ch)) return false;
	return true;
}

// How much this word is needed: frequent words matter, and words that use a slow or error-prone
// key matter more, so weak keys get extra reps without a visible repetition loop.
function weight(word: string, rank: number, stats: StatMap, targetCpm: number, ids: CharIds): number {
	let weak = 0;
	for (const ch of word) {
		const id = ids.get(ch);
		const stat = id ? stats[id] : undefined;
		if (!stat) continue;
		weak += Math.max(0, 1 - confidence(stat, targetCpm)) + errorRate(stat) * 0.5;
	}
	return (1 / (1 + rank * FREQ_DECAY)) * (1 + weak * 2);
}

function pick(pool: { word: string; rank: number }[], stats: StatMap, targetCpm: number, ids: CharIds, seed: number): string {
	const weights = pool.map((p, i) => weight(p.word, p.rank, stats, targetCpm, ids) * (0.7 + 0.6 * pseudo(seed * 977 + i)));
	const total = weights.reduce((a, b) => a + b, 0);
	let r = pseudo(seed) * total;
	for (let i = 0; i < pool.length; i += 1) {
		r -= weights[i];
		if (r <= 0) return pool[i].word;
	}
	return pool[pool.length - 1].word;
}

// Before any real word fits the unlocked keys, a course starts with key repetition: "fjf jfj fff".
function tapOnly(letters: string[], words: number): string {
	const keys = letters.length ? letters : ["f", "j"];
	const a = keys[0];
	const b = keys[1 % keys.length];
	return Array.from({ length: Math.max(1, words) }, (_, i) => `${i % 2 ? b : a}${i % 3 ? a : b}${i % 2 ? b : a}`).join(" ");
}

// Deterministic per seed, so the same state yields the same lesson and tests stay stable.
function pseudo(n: number): number {
	const x = Math.sin(n + 1) * 10000;
	return x - Math.floor(x);
}
