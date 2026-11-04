// What a finished session record actually says about your hands.
//
// A session row carries two different kinds of thing. `chars`, `errors` and `ms` describe one session.
// `stats` describes everything up to and including it: a per-key exponentially weighted mean, with a
// running sample count. That difference is the whole reason this module exists. Diff two consecutive
// snapshots and you get the session back out -- which is what the charts here plot -- but only if you
// diff them in order and remember that a key with no new samples said nothing that session.

import type { SessionRow } from "../atproto/records.ts";
import type { StatMap } from "./stats.ts";
import { CHARS_PER_WORD } from "./stats.ts";

/** The engine's update: one keystroke moves the stored mean 1/16 of the way to the new time. */
const WEIGHT = 1 / 16;

export type TimedSession = SessionRow & { atMs: number };

/** Sessions in the order they were typed. */
export const inOrder = (rows: SessionRow[]): TimedSession[] =>
	[...rows].sort((a, b) => {
		// Dated rows go by time, because that is what a session sequence means. Undated ones -- a record whose
		// rkey is not a readable tid -- keep rkey order and sort after the dated ones rather than colliding at
		// 1970. Sorting by rkey alone would put demo-10 before demo-2 and scramble the tracks silently.
		if (a.atMs && b.atMs && a.atMs !== b.atMs) return a.atMs - b.atMs;
		const both = Boolean(a.atMs) === Boolean(b.atMs);
		if (!both) return a.atMs ? -1 : 1;
		return a.rkey < b.rkey ? -1 : a.rkey > b.rkey ? 1 : 0;
	}) as TimedSession[];

/**
 * What one session did to one key, undoing the running average.
 *
 * `moved` is false when the key was not struck that session: the snapshot carried the old value forward,
 * and inventing a speed for it would put a flat line on the chart where nothing happened.
 */
export type KeyDelta = { moved: boolean; strokes: number; ms: number; errors: number };

export function keyDelta(prev: StatMap[keyof StatMap] | undefined, next: StatMap[keyof StatMap]): KeyDelta {
	const strokes = next.samples - (prev?.samples ?? 0);
	const errors = next.errors - (prev?.errors ?? 0);
	if (strokes <= 0 || !prev || prev.samples === 0) {
		// Either untouched, or the first session ever recorded for this key -- where there is no previous
		// snapshot to subtract and the stored value IS this session's mean.
		return { moved: strokes > 0, strokes: Math.max(0, strokes), ms: Math.round(next.ttMs16 / 16), errors: Math.max(0, errors) };
	}
	// B = A(1-w)^k + S(1-(1-w)^k) for a session whose keystrokes averaged S. Solve for S.
	const pulled = 1 - Math.pow(1 - WEIGHT, strokes);
	return {
		moved: true,
		strokes,
		ms: Math.round((next.ttMs16 - prev.ttMs16 * Math.pow(1 - WEIGHT, strokes)) / (16 * pulled)),
		errors: Math.max(0, errors),
	};
}

/** Where a key was after each session, in the order the sessions were typed. */
export type KeyTrack = { keyId: string; points: { atMs: number; ms: number; strokes: number }[] };

/**
 * Per-key history, one track per key, only for sessions that struck it.
 *
 * A few sessions at the end of a track are the honest shape of this data: the mean was already moving
 * before the first record we still keep, so there is no earlier snapshot to subtract.
 */
export function keyTracks(rows: SessionRow[], limit = 12): KeyTrack[] {
	const ordered = inOrder(rows);
	const byKey = new Map<string, KeyTrack>();
	for (let i = 0; i < ordered.length; i += 1) {
		const prev = i > 0 ? ordered[i - 1].stats : undefined;
		for (const [id, stat] of Object.entries(ordered[i].stats)) {
			if (stat.samples === 0) continue;
			const d = keyDelta(prev?.[id], stat);
			if (!d.moved) continue;
			const track = byKey.get(id) ?? { keyId: id, points: [] };
			track.points.push({ atMs: ordered[i].atMs, ms: d.ms, strokes: d.strokes });
			byKey.set(id, track);
		}
	}
	const tracks = [...byKey.values()].filter((t) => t.points.length >= 2);
	tracks.sort((a, b) => b.points.length - a.points.length || (a.keyId < b.keyId ? -1 : 1));
	return tracks.slice(0, limit);
}

/**
 * Which keys are getting faster, which have stopped, and which are slipping.
 *
 * Splitting the track in half and comparing medians ignores one bad session at the top of a short
 * history, which is exactly what a learner's first session on a new key looks like.
 */
export type KeyTrend = { keyId: string; ms: number; firstMs: number; lastMs: number; drift: number; strokes: number; sessions: number };
export type Trend = { improving: KeyTrend[]; plateaued: KeyTrend[]; slowing: KeyTrend[] };

/** Half a track's speed change counts as a trend. Below that the wobble is smaller than the signal. */
const DRIFT_RATIO = 0.5;

export function trends(rows: SessionRow[], goalMs = 0): Trend {
	const improving: KeyTrend[] = [];
	const plateaued: KeyTrend[] = [];
	const slowing: KeyTrend[] = [];
	for (const track of keyTracks(rows, 100)) {
		const values = track.points.map((p) => p.ms);
		const mid = Math.floor(values.length / 2);
		const firstMs = median(values.slice(0, Math.max(1, mid)));
		const lastMs = median(values.slice(mid));
		const strokes = track.points.reduce((n, p) => n + p.strokes, 0);
		const key: KeyTrend = { keyId: track.keyId, ms: lastMs, firstMs, lastMs, drift: firstMs - lastMs, strokes, sessions: values.length };
		const threshold = (firstMs * DRIFT_RATIO) / 2;
		// Goal order decides the buckets, not the slope. A key under the goal is finished: drift there is noise,
		// and "still improving!" beside "crossed the goal!" for the same letter is two cards contradicting
		// each other -- which is exactly what this version fixed.
		const settled = goalMs > 0 && lastMs <= goalMs;
		if (settled) plateaued.push(key);
		else if (key.drift > threshold) improving.push(key);
		else if (key.drift < -threshold) slowing.push(key);
		else plateaued.push(key);
	}
	const byGain = (a: KeyTrend, b: KeyTrend) => b.drift - a.drift;
	improving.sort(byGain);
	slowing.sort((a, b) => a.drift - b.drift);
	plateaued.sort((a, b) => b.ms - a.ms); // slowest first: that is the one to drill
	return { improving, plateaued, slowing };
}

/**
 * How much of a session was fingers and how much was hovering.
 *
 * `ms` is the wall-clock span between the session's first key and its last. The stroke time is what the
 * per-key means say the keystrokes cost. The remainder is thinking, looking, and reaching -- not slow
 * typing, which is the distinction the line chart cannot make.
 */
export type Hesitation = { atMs: number; wpm: number; strokeWpm: number; typingMs: number; pausedMs: number; pausedShare: number };

export type HesitationPoint = { atMs: number; wpm: number; strokeWpm: number; pausedShare: number };

export function hesitation(rows: SessionRow[]): { points: HesitationPoint[]; avgPausedShare: number; slowestPaused: HesitationPoint | undefined } {
	const ordered = inOrder(rows);
	const points: HesitationPoint[] = [];
	for (let i = 0; i < ordered.length; i += 1) {
		const s = ordered[i];
		if (s.ms <= 0 || s.chars <= 0 || s.atMs <= 0) continue;
		const prev = i > 0 ? ordered[i - 1].stats : undefined;
		let strokeMs = 0;
		for (const [id, stat] of Object.entries(s.stats)) {
			const d = keyDelta(prev?.[id], stat);
			if (d.moved) strokeMs += d.strokes * d.ms;
		}
		// A snapshot that disagrees with the character count is a merged or partial record; trust the
		// count, and clamp so the panel never reports negative pausing.
		if (strokeMs <= 0) strokeMs = s.chars * median(Object.values(s.stats).map((x) => x.ttMs16 / 16).filter((x) => x > 0));
		const typingMs = Math.min(s.ms, Math.round(strokeMs));
		const pausedMs = s.ms - typingMs;
		points.push({
			atMs: s.atMs,
			wpm: Math.round((s.chars * 60000) / (s.ms * CHARS_PER_WORD)),
			strokeWpm: typingMs > 0 ? Math.round((s.chars * 60000) / (typingMs * CHARS_PER_WORD)) : 0,
			pausedShare: Math.round((pausedMs / s.ms) * 100),
		});
	}
	const avgPausedShare = points.length ? Math.round(points.reduce((n, p) => n + p.pausedShare, 0) / points.length) : 0;
	const slowestPaused = [...points].sort((a, b) => b.pausedShare - a.pausedShare)[0];
	return { points, avgPausedShare, slowestPaused };
}

/** The gap the panel is built to show: what you could type at, versus what the clock said. */
export const speedLoss = (points: HesitationPoint[]): { wpm: number; strokeWpm: number; lost: number } => {
	if (!points.length) return { wpm: 0, strokeWpm: 0, lost: 0 };
	const med = (pick: (p: HesitationPoint) => number) => median(points.map(pick));
	const wpm = med((p) => p.wpm);
	const strokeWpm = med((p) => p.strokeWpm);
	return { wpm, strokeWpm, lost: Math.max(0, strokeWpm - wpm) };
};

function median(values: number[]): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export const trendLabel = (t: Trend): string =>
	`${t.improving.length} getting faster · ${t.plateaued.length} stuck · ${t.slowing.length} slipping`;
