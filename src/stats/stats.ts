// Per-key typing statistics. Everything is an integer: the same numbers go into IndexedDB now and
// into atproto records in M4, and the atproto data model has no floating point type.

export type KeyStat = {
	// Exponentially weighted mean time to type this key, in ms x 16 (fixed point keeps the math integral).
	ttMs16: number;
	// The fastest that mean has ever run, in the same units. Monotone: a bad week cannot take it away. This is
	// what the curriculum unlocks on, so a key you once typed at goal speed does not have to be re-earned.
	// Optional: it is derived from history rather than a new fact to keep, and progress written before it
	// existed still says everything worth saying about the key.
	bestMs16?: number;
	samples: number;
	errors: number;
};

export type StatMap = Record<string, KeyStat>;

/** Weight of the newest timed stroke, in 16ths of the mean: 1 means one stroke moves it 1/16 of the way. */
const ALPHA16 = 1;

/** The most a single stroke may be believed to say about a key, as a multiple of the mean it replaces. A
 *  keystroke interval is evidence about typing; the gap after you went to make tea is evidence about the
 *  kettle. Without a ceiling here, one 40-second pause moved a key from 121 wpm to 17 and the headline
 *  average came with it. */
const OUTLIER_TIMES = 4;

/** And the most a key with no mean yet can be seeded with. Its first timed stroke is the one pause this
 *  module cannot judge against anything, so it gets an absolute limit instead. Two seconds is already well
 *  past a hunt-and-peck interval, and the 1/16 pull above is what carries a genuinely slow key down. */
const COLD_MAX_MS = 2_000;

export function emptyStat(): KeyStat {
	return { ttMs16: 0, samples: 0, errors: 0 };
}

/**
 * The best a key has run at, in ms x 16. Progress written before `bestMs16` existed has no record of its
 * own past, so its current mean is the honest answer: it is the only measurement there is.
 */
export function bestMs(stat: KeyStat): number {
	return stat.bestMs16 && stat.bestMs16 > 0 ? stat.bestMs16 : stat.ttMs16;
}

export function observe(stat: KeyStat, elapsedMs: number): KeyStat {
	// 0 ms is not a speed, it is the absence of one: the first keystroke of a run has no earlier stroke to
	// measure against, and so does two strokes inside the same millisecond. Folding that into the mean as a
	// measurement credited the key that happened to START a line with infinite speed -- measured: a key at
	// 28 ms while every other row on the screen sat at 230, and an average (59 wpm) faster than all of them.
	// The keystroke still counts, because it happened: it is a character typed and a sample of exposure. It
	// just contributes no observation of time.
	if (!(elapsedMs > 0)) return { ...stat, samples: stat.samples + 1 };
	// Past four times the current mean a stroke is not a slow keystroke, it is a pause, and it is filed as
	// the slowest keystroke this key has evidence for.
	const observed = Math.min(Math.round(elapsedMs) * 16, hasTiming(stat) ? stat.ttMs16 * OUTLIER_TIMES : COLD_MAX_MS * 16);
	const ttMs16 = hasTiming(stat) ? stat.ttMs16 + Math.round(((observed - stat.ttMs16) * ALPHA16) / 16) : observed;
	// One sixteenth of the way toward it, not all the way: this is the running average every screen reads,
	// and `keyDelta` in insights.ts undoes exactly this step to recover one session from two snapshots.
	// Applying ALPHA16 as a plain multiplier rather than a weight in 16ths made the "average" the last
	// keystroke, which is how a key typed two hundred times could print 12 wpm off one stray pause.
	return {
		ttMs16,
		bestMs16: minTiming(bestMs(stat), ttMs16),
		samples: stat.samples + 1,
		errors: stat.errors,
	};
}

/** The faster of two means, where 0 means "no measurement" rather than "instantly". */
function minTiming(a: number, b: number): number {
	if (a <= 0) return Math.max(0, b);
	if (b <= 0) return a;
	return Math.min(a, b);
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

/** The fastest mean this key has ever held, in ms. */
export function bestTimeMs(stat: KeyStat): number {
	const best = bestMs(stat);
	return best > 0 ? Math.round(best / 16) : 0;
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

/** The same, measured against the best speed this key has ever held. A letter unlocks on this, not on how
 *  the key is going today: a tired evening should not take back a letter you earned. */
export function bestConfidence(stat: KeyStat, targetCpm: number): number {
	const tt = bestTimeMs(stat);
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
		// A `min` is the one merge that cannot double anything: it is idempotent, commutative and associative,
		// so a device that folds the same record in twice keeps the best it already knew.
		bestMs16: minTiming(bestMs(a), bestMs(b)),
		samples: a.samples + b.samples,
		errors: a.errors + b.errors,
	};
}

// What a key has learned between two snapshots of the same record: the strokes that arrived in between,
// at the speed the record now says it is running.
//
// The count is exact. The mean is not recoverable, and must not be invented. `mean x samples` looks like a
// total you could subtract, but this is an EWMA: the old observations have already been decayed out of the
// mean, so the product is not the time they took. Differencing two snapshots therefore reads a speed
// change as a different speed — measured, against a device that struck this key 100 times and then added
// ten strokes at 40 ms: `0 ms` (the product shrank, so the clamp said "no timing here") when the other
// device got faster, and `1875 ms` when it got slower instead of the 400 ms it actually typed. Both are
// off the board in opposite directions, and either one drags the merged average with it.
//
// So the fold takes the only claim a record can honestly make — "this many strokes are new, and this key
// currently runs at this speed" — and lets `merge` weight it by the new strokes. The bias is the record's
// own memory of the older strokes, about sixteen of them, and it shrinks in exactly the case where it
// would matter: a device that has added a lot of strokes has a mean made of them.
export function keyGrowth(from: KeyStat | undefined, to: KeyStat): KeyStat | undefined {
	if (!from) return to.samples > 0 ? { ...to } : undefined;
	const added = to.samples - from.samples;
	if (added <= 0) return undefined; // the same record, or one that came back smaller: nothing to learn here
	// `bestMs16` is the record's current claim, not a difference: it only ever gets faster.
	return { ttMs16: Math.max(0, to.ttMs16), bestMs16: bestMs(to), samples: added, errors: Math.max(0, to.errors - from.errors) };
}

// The map-level form of `keyGrowth`: what a whole progress record has learned since it was last accounted
// for. Folding one in is `mergeAll(local, progressGrowth(seen, remote))`.
export function progressGrowth(seen: StatMap, remote: StatMap): StatMap {
	const out: StatMap = {};
	for (const [id, stat] of Object.entries(remote)) {
		const growth = keyGrowth(seen[id], stat);
		if (growth && growth.samples > 0) out[id] = growth;
	}
	return out;
}

export function mergeAll(a: StatMap, b: StatMap): StatMap {
	const out: StatMap = { ...a };
	for (const [id, stat] of Object.entries(b)) out[id] = out[id] ? merge(out[id], stat) : { ...stat };
	return out;
}

// Summing per-key samples gives the session totals without double-counting a repeated key.
export function totals(stats: StatMap): { chars: number; errors: number } {
	let chars = 0;
	let errors = 0;
	for (const s of Object.values(stats)) {
		chars += s.samples;
		errors += s.errors;
	}
	return { chars, errors };
}
