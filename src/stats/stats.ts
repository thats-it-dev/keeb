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
	// 0 ms is not a speed, it is the absence of one: the first keystroke of a run has no earlier stroke to
	// measure against, and so does two strokes inside the same millisecond. Folding that into the mean as a
	// measurement credited the key that happened to START a line with infinite speed -- measured: a key at
	// 28 ms while every other row on the screen sat at 230, and an average (59 wpm) faster than all of them.
	// The keystroke still counts, because it happened: it is a character typed and a sample of exposure. It
	// just contributes no observation of time.
	if (!(elapsedMs > 0)) return { ...stat, samples: stat.samples + 1 };
	const s = Math.round(elapsedMs) * 16;
	return { ttMs16: hasTiming(stat) ? stat.ttMs16 + ALPHA16 * (s - stat.ttMs16) : s, samples: stat.samples + 1, errors: stat.errors };
}

/** True when at least one keystroke of this key was actually timed. `samples` alone is not enough: a key can
 *  have been struck ten times and never once with a measurable gap. */
export function hasTiming(stat: KeyStat): boolean {
	return stat.ttMs16 > 0;
}

export function observeError(stat: KeyStat, elapsedMs: number): KeyStat {
	return { ...observe(stat, elapsedMs), errors: stat.errors + 1 };
}

export function timeToTypeMs(stat: KeyStat): number {
	// 0 means "unknown", not "instant" -- which is what the callers below assume.
	return hasTiming(stat) ? Math.round(stat.ttMs16 / 16) : 0;
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
	// Only the keys that were actually TIMED get a vote in the mean. Counting an untimed key's samples here
	// is how the phantom 0 ms of a run boundary travelled into a merged record: measured locally, a key at
	// 100 ms x 16 merging with a device that only ever struck it first-in-run came out at 63 ms -- the other
	// device's untimed strokes contributed 3 observations of zero, and 3/8ths of the mean was fiction.
	const ta = hasTiming(a) ? a.samples : 0;
	const tb = hasTiming(b) ? b.samples : 0;
	const n = ta + tb;
	return {
		ttMs16: n === 0 ? 0 : Math.round((a.ttMs16 * ta + b.ttMs16 * tb) / n),
		samples: a.samples + b.samples,
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
