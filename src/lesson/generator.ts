// The line the learner is about to type. Two sources, one rule: every word is built from the letters the
// ladder has opened, and every word carries the focused letter.
//
// The default source is the letter model in model.ts, because six letters of real English is a short list
// (`rain`, `near`, `saner` — that is roughly the shelf) and a lesson that repeats four words teaches
// boredom, not typing. `realWords` switches to the corpus and lets the model fill the gaps.

import { WORDS } from "./corpus.ts";
import { model, word, type Rng } from "./model.ts";
import type { StatMap } from "../stats/stats.ts";

// char -> key id, from Resolved.byChar. Stats are stored by key id and words are stored by character, so
// the generator needs this mapping to look a character's stats up.
export type CharIds = Map<string, string>;

export type Lesson = {
	/** The characters this line may contain, including the space. */
	letters: string[];
	text: string;
	/** The character every word in it carries, if one was asked for. */
	focus?: string;
};

export type LessonInput = {
	/** Unlocked characters, lowercase. */
	letters: string[];
	/** Build every word around this one. */
	focus?: string;
	stats: StatMap;
	targetCpm: number;
	ids: CharIds;
	/** Take words from the corpus instead of inventing them. */
	realWords: boolean;
	/** Which line this is. It seeds the random source, so the same state yields the same lesson. */
	seed: number;
	words?: number;
};

/** About 100 characters: the length of a keybr line, and long enough that a new letter shows up a dozen times. */
const WORDS_PER_LINE = 14;
/** How far down the corpus to look for words that fit the unlocked letters. */
const POOL = 1000;
/** Fewer real words than this is not a lesson, so invented ones join to make up the difference. */
const MIN_CANDIDATES = 15;
/** A word at corpus rank n is worth 1 / (1 + n * FREQ_DECAY): the head of the list matters, the tail less. */
const FREQ_DECAY = 0.012;
/** How many words to sketch before keeping the one that drills the most. */
const DRAFTS = 4;
/** How many letters the line forces in beyond the focus. The rest wait their turn on a later line. */
const FORCED_PER_LINE = 3;
/** How many times to redraw a word that repeats the one before it. Repetition is what makes a generated
 *  lesson feel broken, and a rare focus letter on a full board is exactly where it shows. */
const REPEATS = 3;

export function lesson(input: LessonInput): Lesson {
	const { letters, focus, stats, targetCpm, ids } = input;
	const words = input.words ?? WORDS_PER_LINE;
	const allowed = new Set([...letters, " "]); // the space separates words, so it is always on the menu
	const rng = makeRng(input.seed);
	const need = focus === undefined ? [] : [focus];
	const real = input.realWords ? realCandidates(letters, focus) : [];
	const nextWord = () =>
		real.length >= MIN_CANDIDATES || (real.length > 0 && rng() < 0.8) ? realPick(real, stats, targetCpm, ids, rng) : modelWord(allowed, need, stats, targetCpm, ids, rng);
	const line: string[] = [];

	for (let i = 0; i < words; i += 1) {
		let w = nextWord();
		for (let retry = 0; retry < REPEATS && w === line[i - 1] && w !== ""; retry += 1) w = nextWord();
		line.push(w);
	}

	// An unlocked letter that never appears is a letter nobody is asked to type, one nobody types never gets
	// faster, and one that never gets faster holds the next letter locked. One line cannot carry every rare
	// letter as well as the focus, so it carries FORCED_PER_LINE of them and the rest take their turn on a
	// later line: the starting position moves with the seed, so the wait is bounded by how many are waiting.
	const gaps = letters.filter((ch) => !line.some((w) => w.includes(ch)));
	const first = gaps.length === 0 ? 0 : input.seed % gaps.length;
	for (let i = 0; i < Math.min(FORCED_PER_LINE, gaps.length, line.length); i += 1) {
		line[i] = modelWord(allowed, [...need, gaps[(first + i) % gaps.length]!], stats, targetCpm, ids, rng);
	}

	return { letters: [...allowed], text: line.filter((w) => w !== "").join(" ") || need[0] || "", focus };
}

/** The corpus, narrowed to what this learner can type and, when there is a focus, to what drills it. */
function realCandidates(letters: string[], focus: string | undefined): { word: string; rank: number }[] {
	const allowed = new Set(letters);
	const out: { word: string; rank: number }[] = [];
	for (let rank = 0; rank < WORDS.length && out.length < POOL; rank += 1) {
		const w = WORDS[rank];
		if (![...w].every((ch) => allowed.has(ch))) continue;
		if (focus !== undefined && !w.includes(focus)) continue;
		out.push({ word: w, rank });
	}
	return out;
}

function realPick(pool: { word: string; rank: number }[], stats: LessonInput["stats"], targetCpm: number, ids: CharIds, rng: Rng): string {
	if (pool.length === 0) return "";
	const weights = pool.map((p, i) => weight(p.word, p.rank, stats, targetCpm, ids) * (0.7 + 0.6 * rngAt(rng, i)));
	const total = weights.reduce((a, b) => a + b, 0);
	let r = rng() * total;
	for (let i = 0; i < pool.length; i += 1) {
		r -= weights[i];
		if (r <= 0) return pool[i].word;
	}
	return pool[pool.length - 1].word;
}

/** Draft a few words and keep the one that drills the most, never at the cost of the letters it must carry. */
function modelWord(allowed: Set<string>, need: string[], stats: LessonInput["stats"], targetCpm: number, ids: CharIds, rng: Rng): string {
	const drafts: string[] = [];
	for (let draft = 0; draft < DRAFTS; draft += 1) {
		const w = word(model(), allowed, need, rng);
		if (w === "") continue;
		drafts.push(w);
		if (need.length > 0 && coverage(w, need) === need.length) break; // it carries everything asked of it
	}
	// Letters first, practice second: a word that carries the required letters beats one that merely sits
	// on a slow key.
	drafts.sort((a, b) => coverage(b, need) - coverage(a, need) || weakness(b, stats, targetCpm, ids) - weakness(a, stats, targetCpm, ids));
	return drafts[0] ?? "";
}

/** How many of the letters this line is required to teach are inside this word. */
function coverage(w: string, need: string[]): number {
	return need.filter((ch) => w.includes(ch)).length;
}

/** How much this word is needed: frequent words matter, and words on a slow or flaky key matter more. */
function weight(w: string, rank: number, stats: LessonInput["stats"], targetCpm: number, ids: CharIds): number {
	return (1 / (1 + rank * FREQ_DECAY)) * (1 + weakness(w, stats, targetCpm, ids) * 2);
}

/** Summed shortfall of the keys in a word: 0 when all of them are at goal, up from a slow or missed key. */
function weakness(w: string, stats: LessonInput["stats"], targetCpm: number, ids: CharIds): number {
	const goal = targetCpm <= 0 ? 0 : Math.round(60_000 / targetCpm);
	let weak = 0;
	for (const ch of w) {
		const id = ids.get(ch);
		const stat = id ? stats[id] : undefined;
		if (!stat) continue;
		const ms = stat.ttMs16 > 0 ? stat.ttMs16 / 16 : 0;
		const conf = ms > 0 && goal > 0 ? goal / ms : 0;
		const samples = stat.samples || 1;
		weak += Math.max(0, 1 - conf) + (stat.errors / samples) * 0.5;
	}
	return weak;
}

/** mulberry32: small, deterministic from one integer, and different seeds give different output. */
export function makeRng(seed: number): Rng {
	let s = (seed >>> 0) + 0x6d2b79f5;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A per-candidate jitter that does not consume the stream, so the pool order cannot change the draw. */
function rngAt(rng: Rng, i: number): number {
	const saved = rng();
	return 0.5 + 0.5 * Math.sin(i * 977 + saved * 100);
}
