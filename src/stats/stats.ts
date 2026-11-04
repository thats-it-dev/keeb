// Per-key typing statistics. Everything is an integer: the same numbers go into IndexedDB now and
// into atproto records in M4, and the atproto data model has no floating point type.

export type KeyStat = {
	// Exponentially weighted mean time to type this key, in ms x 16 (fixed point keeps the math integral).
	ttMs16: number;
	samples: number;
	errors: number;
};

export type StatMap = Record<string, KeyStat>;

// 1/16 weight on the newest sample: enough responsiveness to follow improvement, enough inertia to
// survive one bad keystroke.
const ALPHA16 = 1;

export function emptyStat(): KeyStat {
	return { ttMs16: 0, samples: 0, errors: 0 };
}

export function observe(stat: KeyStat, elapsedMs: number): KeyStat {
	const s = Math.max(0, Math.round(elapsedMs)) * 16;
	return { ttMs16: stat.samples === 0 ? s : stat.ttMs16 + ALPHA16 * (s - stat.ttMs16), samples: stat.samples + 1, errors: stat.errors };
}

export function observeError(stat: KeyStat, elapsedMs: number): KeyStat {
	return { ...observe(stat, elapsedMs), errors: stat.errors + 1 };
}

export function timeToTypeMs(stat: KeyStat): number {
	return stat.samples === 0 ? 0 : Math.round(stat.ttMs16 / 16);
}

export function errorRate(stat: KeyStat): number {
	return stat.samples === 0 ? 0 : stat.errors / stat.samples;
}

// Characters per minute implied by a time-per-character.
export function cpmFrom(ttMs: number): number {
	return ttMs <= 0 ? 0 : Math.round(60000 / ttMs);
}

export function targetTimeMs(targetCpm: number): number {
	return targetCpm <= 0 ? 0 : Math.round(60000 / targetCpm);
}

// The convention every typist tool means by "word": five characters, including the space. It is why the
// stored unit stays characters-per-minute -- a word count is a display choice, and rounding at the last
// step keeps a stored goal exactly convertible instead of off by a character.
export const CHARS_PER_WORD = 5;

/** Words per minute implied by a time-per-character. */
export function wpmFrom(ttMs: number): number {
	return ttMs <= 0 ? 0 : Math.round(60000 / (ttMs * CHARS_PER_WORD));
}

/** Words per minute for a speed already counted in characters. */
export const cpmToWpm = (cpm: number): number => Math.round(cpm / CHARS_PER_WORD);

/** The stored goal, given a number typed into a words-per-minute field. */
export const wpmToCpm = (wpm: number): number => Math.round(wpm * CHARS_PER_WORD);

// keybr's confidence: > 1 means this key is faster than the goal, so it is safe to teach the next one.
// Returns 0 with no data, which keeps a fresh key locked.
export function confidence(stat: KeyStat, targetCpm: number): number {
	const tt = timeToTypeMs(stat);
	const goal = targetTimeMs(targetCpm);
	if (tt === 0 || goal === 0) return 0;
	return goal / tt;
}

// Two devices accumulate independently; summing the parts merges without a coordinator.
export function merge(a: KeyStat, b: KeyStat): KeyStat {
	if (a.samples === 0) return { ...b };
	if (b.samples === 0) return { ...a };
	const n = a.samples + b.samples;
	return {
		ttMs16: Math.round((a.ttMs16 * a.samples + b.ttMs16 * b.samples) / n),
		samples: n,
		errors: a.errors + b.errors,
	};
}

export function mergeAll(a: StatMap, b: StatMap): StatMap {
	const out: StatMap = { ...a };
	for (const [id, stat] of Object.entries(b)) out[id] = out[id] ? merge(out[id], stat) : { ...stat };
	return out;
}

// Slowest first, ties broken by error rate: this is the order the lesson generator drills.
export function ranked(stats: StatMap, targetCpm: number): string[] {
	return Object.keys(stats).sort((x, y) => {
		const d = confidence(stats[x], targetCpm) - confidence(stats[y], targetCpm);
		return d !== 0 ? d : errorRate(stats[y]) - errorRate(stats[x]);
	});
}
