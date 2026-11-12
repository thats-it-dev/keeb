// The numbers behind the stats screen. One rule runs through this file: a key is only judged by the
// samples that exist for it. A key never struck has no speed, which is not the same as a speed of zero,
// and counting it as one is how a stats screen starts lying.

import { emptyStat, errorRate, bestTimeMs, timeToTypeMs, type StatMap } from "./stats.ts";
import { CHARS_PER_WORD } from "./stats.ts";

export type KeyRow = {
	id: string;
	label: string;
	/** ms per key from the EWMA, or 0 when the key has never been struck. */
	ms: number;
	wpm: number;
	samples: number;
	errors: number;
	/** 0-1. Nothing is stored beyond those two fields, so this is the only honest error measure. */
	err: number;
	/** goal / actual. Above 1 means faster than the target. Deliberately NOT capped: the ladder gates on
	 * exactly this number, so a second definition here would disagree with what unlocks. */
	conf: number;
	/** This key is the next one the ladder will open. */
	next: boolean;
	/** This key is the one the current lesson is built around. */
	focus: boolean;
	/** The best this key has ever run at, in ms — what the curriculum unlocks on. 0 with no measurement. */
	bestMs: number;
};

export type Overview = {
	/** Every key of the current layout, worst first; anything unmeasured sinks to the bottom. */
	keys: KeyRow[];
	unlocked: number;
	total: number;
	/** Mean over keys with a measured speed -- see `measured` for why struck is not the same as timed. */
	avgMs: number;
	avgWpm: number;
	/** Distinct keys with a measured speed — a count of exposure, never of strokes. See below. */
	covered: number;
	errPct: number;
	/** Share of timed keys at or above goal. */
	readyPct: number;
	/** The letter every word in the current line contains, or "" when the lesson has nothing to fix. */
	focusLabel: string;
	/** The same key by id, for the board that has to ring it. "" when there is no focus. */
	focusId: string;
	/** 0-100 of the samples that fell on the left hand; 50 when there is no data to balance. */
	handBalance: number;
	leftSamples: number;
	rightSamples: number;
	/** Worst five, for "practise these". */
	slowest: KeyRow[];
	/** Keys with a measured speed, in the same order as `keys`. The bar list draws these and nothing else: a
	 *  key never struck has no bar to draw, and 40 empty rows bury the handful that mean something. A key
	 *  struck only as the first stroke of a run has no measurement either, so it waits with the rest. */
	measured: KeyRow[];
	/** Keys with no measurement and no bar, in layout order: still locked, or unlocked and never tried. */
	waiting: KeyRow[];
	/** Keys the ladder has opened but never measured: unlocked, never used in a way this screen can time. */
	untried: KeyRow[];
};

export type KeyInfo = { id: string; label: string; hand: "left" | "right" | "none" };

/** What the curriculum says about this layout right now. The screen reads the same `Ladder` the lesson
 *  engine builds its lines from, so "at goal" here and "unlocks next" there cannot mean different things. */
export type Curriculum = { unlocked: string[]; next?: string; focus?: string };

/**
 * `keys` comes from the resolved layout, not from the stats record: listing only keys that have samples
 * would hide the ones you have not tried, and those are the ones the screen exists to show.
 *
 * Note what is NOT here: a "characters typed" total. `samples` is sample-weighted-mean bookkeeping, so
 * summing it reports how many keys you have touched, not how many you have hit — a 200-character session
 * against 40 old samples per key moves the total by a couple. Strokes live in the session records, and a
 * lifetime total needs an aggregate we do not store yet. So the screen says "keys covered".
 */
export function overview(stats: StatMap, targetCpm: number, keys: KeyInfo[], curriculum: Curriculum): Overview {
	const goalMs = targetCpm <= 0 ? 0 : Math.round(60000 / targetCpm);
	const { unlocked, next: nextId, focus: focusId } = curriculum;

	const rows: KeyRow[] = keys.map((k) => {
		const s = stats[k.id] ?? emptyStat();
		const ms = timeToTypeMs(s);
		return {
			id: k.id,
			label: k.label,
			ms,
			wpm: wpm(ms),
			samples: s.samples,
			errors: s.errors,
			err: s.samples > 0 ? errorRate(s) : 0,
			conf: goalMs > 0 && ms > 0 ? goalMs / ms : 0,
			bestMs: bestTimeMs(s),
			next: k.id === nextId,
			focus: k.id === focusId,
		};
	});

	// Untried last, then by confidence, then by error rate: two keys at the same speed are not equally
	// worth drilling if one of them is flaky.
	rows.sort((a, b) => {
		if ((a.samples > 0) !== (b.samples > 0)) return a.samples > 0 ? -1 : 1;
		const d = a.conf - b.conf;
		return d !== 0 ? d : b.err - a.err;
	});

	// "Has been struck" and "has a measured speed" are different things, and conflating them is what let the average come out faster than
	// every key inside it: a struck-but-never-timed key contributes ms 0 to sumMs, and 0 divided by a count is
	// a very fast keyboard. Sample counts still add up below, because the strokes did happen.
	const practised = rows.filter((r) => r.ms > 0);
	const sumMs = practised.reduce((t, r) => t + r.ms, 0);
	// Errors and exposure count every stroke that happened, including the ones with no measurable interval --
	// a mistype at the start of a run is still a mistype. Only the SPEED mean is restricted to timed strokes.
	const struck = rows.filter((r) => r.samples > 0);
	const errSum = struck.reduce((t, r) => t + r.errors, 0);
	const sampleSum = struck.reduce((t, r) => t + r.samples, 0);
	const leftSamples = struck.filter((r) => handOf(keys, r.id) === "left").reduce((t, r) => t + r.samples, 0);
	const rightSamples = sampleSum - leftSamples;

	return {
		keys: rows,
		unlocked: unlocked.length,
		total: keys.length,
		avgMs: practised.length ? Math.round(sumMs / practised.length) : 0,
		avgWpm: practised.length ? wpm(Math.round(sumMs / practised.length)) : 0,
		covered: practised.length,
		errPct: sampleSum ? Math.round((errSum / sampleSum) * 1000) / 10 : 0,
		focusLabel: focusId === undefined ? "" : keys.find((k) => k.id === focusId)?.label ?? "",
		focusId: focusId ?? "",
		readyPct: practised.length ? Math.round((practised.filter((r) => r.conf >= 1).length / practised.length) * 100) : 0,
		handBalance: sampleSum ? Math.round((leftSamples / sampleSum) * 100) : 50,
		leftSamples,
		rightSamples,
		slowest: practised.slice(0, 5),
		measured: practised,
		waiting: rows.filter((r) => r.ms === 0),
		untried: rows.filter((r) => r.ms === 0 && unlocked.includes(r.id)),
	};
}

const handOf = (keys: KeyInfo[], id: string) => keys.find((k) => k.id === id)?.hand ?? "none";

/** Words per minute from a time per character. The display unit, never the stored one. */
export function wpm(msPerChar: number): number {
	return msPerChar <= 0 ? 0 : Math.round(60000 / (msPerChar * CHARS_PER_WORD));
}
