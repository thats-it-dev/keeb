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

// Weight per word: a small preference for shorter words, plus a push toward the words that use the
// keys the learner is worst at. A word using a locked key scores 0 and never appears.
function score(word: string, stats: StatMap, targetCpm: number, allowed: Set<string>, ids: CharIds): number {
	let weak = 0;
	for (const ch of word) {
		if (!allowed.has(ch)) return 0;
		const id = ids.get(ch);
		const stat = id ? stats[id] : undefined;
		if (!stat) continue;
		weak += Math.max(0, 1 - confidence(stat, targetCpm)) + errorRate(stat) * 0.5;
	}
	return (1 + weak * 1.5) / (1 + word.length * 0.08);
}

export function lesson(letters: string[], stats: StatMap, targetCpm: number, ids: CharIds, words = WORDS_PER_LINE): Lesson {
	const allowed = new Set([...letters, " "]); // words are separated by the space key, always allowed
	const pool: string[] = [];
	for (const word of WORDS) {
		if (score(word, stats, targetCpm, allowed, ids) > 0) pool.push(word);
		if (pool.length >= 300) break;
	}
	if (!pool.length) return { letters: [...allowed], text: tapOnly([...allowed], words) };
	const out: string[] = [];
	for (let i = 0; i < words; i += 1) out.push(pick(pool, stats, targetCpm, allowed, ids, i));
	return { letters: [...allowed], text: out.join(" ") };
}

// Before any real word fits the unlocked keys, a course starts with key repetition: "fjf jfj fff".
function tapOnly(letters: string[], words: number): string {
	const keys = letters.length ? letters : ["f", "j"];
	const a = keys[0];
	const b = keys[1 % keys.length];
	return Array.from({ length: Math.max(1, words) }, (_, i) => `${i % 2 ? b : a}${i % 3 ? a : b}${i % 2 ? b : a}`).join(" ");
}

// Weighted pick by a stable seed, so the same state yields the same lesson (and tests stay green).
function pick(pool: string[], stats: StatMap, targetCpm: number, allowed: Set<string>, ids: CharIds, seed: number): string {
	const weights = pool.map((w, i) => score(w, stats, targetCpm, allowed, ids) * (0.6 + 0.8 * pseudo(seed * 977 + i)));
	const total = weights.reduce((a, b) => a + b, 0);
	let r = pseudo(seed) * total;
	for (let i = 0; i < pool.length; i += 1) {
		r -= weights[i];
		if (r <= 0) return pool[i];
	}
	return pool[pool.length - 1];
}

function pseudo(n: number): number {
	const x = Math.sin(n + 1) * 10000;
	return x - Math.floor(x);
}
