// Turning session records into a history a person can read.
//
// Pure on purpose, like overview.ts: a day bucket, an average and a streak are claims about arithmetic,
// and a claim you can only check by mounting a chart is a claim nobody checks.
//
// One unit rule runs through this file. The stored unit is characters per minute; `ms` on a session is its
// wall-clock span, not a per-key timing. Speed is derived from the pair (chars, ms) and never from a mean
// of means -- averaging five sessions' wpm weights a 30-second sprint the same as a 20-minute one, while
// dividing total characters by total time answers the question the chart is actually asking.

import { CHARS_PER_WORD } from "./stats.ts";
import { sessionStrokeMs } from "./insights.ts";
import type { SessionRow } from "../atproto/records.ts";

export type Day = {
	/** Local calendar day, YYYY-MM-DD. Local because a practice day is the day you lived it, not UTC's. */
	day: string;
	/** Earliest session in that day, so days sort and label by something real. */
	atMs: number;
	sessions: number;
	chars: number;
	errors: number;
	/** Wall-clock minutes spent practising. */
	minutes: number;
	/** Minutes of that which were keystrokes rather than pauses. Never above `minutes`. */
	strokeMinutes: number;
	/** What the fingers produced, with the thinking taken out. Always >= wpm, and equal to it on a good day. */
	strokeWpm: number;
	wpm: number;
	errPct: number;
};

export type History = {
	/** Most recent first, which is the order a person reads a history in. */
	days: Day[];
	sessions: number;
	chars: number;
	minutes: number;
	/** Fingers-only speed across the window, from total characters over total stroke time. */
	strokeWpm: number;
	wpm: number;
	errPct: number;
	/** Days with at least one session, and the run of consecutive days ending today or yesterday. */
	activeDays: number;
	streak: number;
	/** Best single day. */
	best?: { day: string; wpm: number };
	/** Sessions whose rkey carried no usable time: counted in the totals, absent from the chart. */
	undated: number;
};

/** Local calendar day for a timestamp. */
export function dayKey(ms: number): string {
	const d = new Date(ms);
	const m = `${d.getMonth() + 1}`.padStart(2, "0");
	const day = `${d.getDate()}`.padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

/** The day before a day key, in local time. */
function prevDay(day: string): string {
	return shiftDay(day, -1);
}

const wpmOf = (chars: number, ms: number): number => (ms <= 0 || chars <= 0 ? 0 : Math.round(chars / (ms / 60000) / CHARS_PER_WORD));

type Acc = { day: string; atMs: number; sessions: number; chars: number; errors: number; ms: number; strokeMs: number };

export function history(rows: SessionRow[], nowMs = Date.now()): History {
	const byDay = new Map<string, Acc>();
	// Stroke time has to come from the sessions in typed order, because each record's per-key stats are a
	// cumulative snapshot: the time a session's keystrokes cost is the difference it made to that snapshot.
	const strokes = sessionStrokeMs(rows);
	let chars = 0;
	let errors = 0;
	let ms = 0;
	let strokeMs = 0;
	let undated = 0;

	for (const r of rows) {
		const sMs = Math.min(r.ms, strokes.get(r) ?? 0); // never more stroke time than the session lasted
		chars += r.chars;
		errors += r.errors;
		ms += r.ms;
		strokeMs += sMs;
		if (!r.atMs) {
			undated += 1;
			continue; // in the totals, out of the chart
		}
		const key = dayKey(r.atMs);
		const d = byDay.get(key) ?? { day: key, atMs: r.atMs, sessions: 0, chars: 0, errors: 0, ms: 0, strokeMs: 0 };
		d.sessions += 1;
		d.chars += r.chars;
		d.errors += r.errors;
		d.ms += r.ms;
		d.strokeMs += sMs;
		d.atMs = Math.min(d.atMs, r.atMs);
		byDay.set(key, d);
	}

	const days = [...byDay.values()]
		.map((d) => ({
			day: d.day,
			atMs: d.atMs,
			sessions: d.sessions,
			chars: d.chars,
			errors: d.errors,
			minutes: Math.round(d.ms / 60000),
			strokeMinutes: Math.round(d.strokeMs / 60000),
			strokeWpm: wpmOf(d.chars, d.strokeMs),
			wpm: wpmOf(d.chars, d.ms),
			errPct: d.chars ? Math.round((d.errors / d.chars) * 1000) / 10 : 0,
		}))
		.sort((a, b) => (a.day < b.day ? 1 : -1));

	return {
		days,
		sessions: rows.length,
		chars,
		minutes: Math.round(ms / 60000),
		strokeWpm: wpmOf(chars, strokeMs),
		wpm: wpmOf(chars, ms),
		errPct: chars ? Math.round((errors / chars) * 1000) / 10 : 0,
		activeDays: days.length,
		streak: streak(days.map((d) => d.day), dayKey(nowMs)),
		best: days.filter((d) => d.wpm > 0).reduce<(typeof days)[number] | undefined>((top, d) => (!top || d.wpm > top.wpm ? d : top), undefined),
		undated,
	};
}

/** Consecutive days with a session, ending today or yesterday. A gap yesterday has not broken it yet. */
function streak(days: string[], today: string): number {
	const set = new Set(days);
	let cursor = set.has(today) ? today : prevDay(today);
	if (!set.has(cursor)) return 0;
	let n = 0;
	while (set.has(cursor)) {
		n += 1;
		cursor = prevDay(cursor);
	}
	return n;
}

/**
 * One point per CALENDAR day, oldest left, across the span the data covers. Not one point per day that
 * has data: a bar chart indexed by position hides which days were skipped, which is the one thing a
 * practice history has to show honestly. A skipped day arrives with sessions 0 and draws nothing.
 *
 * `limit` caps the span rather than the sessions shown, and the totals are unaffected, because they come
 * from history(), not from what is drawn.
 */
export function series(h: History, limit = 30): Point[] {
	if (!h.days.length) return [];
	const byDay = new Map(h.days.map((d) => [d.day, d]));
	// Newest day with data, even if that is yesterday at 00:05; anchoring on today would pad the right edge
	// with empty days every morning.
	const newest = h.days[0]!.day;
	const span = Math.min(daysBetween(h.days[h.days.length - 1]!.day, newest) + 1, Math.max(1, limit));
	const out: Point[] = [];
	for (let i = span - 1; i >= 0; i -= 1) {
		// Walking backwards from the newest day and emitting oldest-first, by index: no copy, no reverse.
		const day = shiftDay(newest, -i);
		const d = byDay.get(day);
		out.push({ day, wpm: d?.wpm ?? 0, strokeWpm: d?.strokeWpm ?? 0, minutes: d?.minutes ?? 0, sessions: d?.sessions ?? 0 });
	}
	return out;
}

export type Point = { day: string; wpm: number; strokeWpm: number; minutes: number; sessions: number };

/** The day `delta` days from `day`, in local time. Noon arithmetic keeps DST from shifting the date. */
function shiftDay(day: string, delta: number): string {
	const [y, m, d] = day.split("-").map(Number);
	const noon = new Date(y!, (m ?? 1) - 1, d ?? 1, 12);
	noon.setDate(noon.getDate() + delta);
	return dayKey(noon.getTime());
}

function daysBetween(from: string, to: string): number {
	const [ay, am, ad] = from.split("-").map(Number);
	const [by, bm, bd] = to.split("-").map(Number);
	const a = new Date(ay!, (am ?? 1) - 1, ad ?? 1, 12).getTime();
	const b = new Date(by!, (bm ?? 1) - 1, bd ?? 1, 12).getTime();
	return Math.max(0, Math.round((b - a) / DAY));
}

const DAY = 86_400_000;
