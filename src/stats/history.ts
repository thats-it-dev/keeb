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
	wpm: number;
	errPct: number;
};

export type History = {
	/** Most recent first, which is the order a person reads a history in. */
	days: Day[];
	sessions: number;
	chars: number;
	minutes: number;
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

/** The day before a day key, in local time, by stepping back noon minus a day (dollar-free DST math). */
function prevDay(day: string): string {
	const [y, m, d] = day.split("-").map(Number);
	const noon = new Date(y, (m ?? 1) - 1, d ?? 1, 12);
	noon.setDate(noon.getDate() - 1);
	return dayKey(noon.getTime());
}

const wpmOf = (chars: number, ms: number): number => (ms <= 0 || chars <= 0 ? 0 : Math.round(chars / (ms / 60000) / CHARS_PER_WORD));

type Acc = { day: string; atMs: number; sessions: number; chars: number; errors: number; ms: number };

export function history(rows: SessionRow[], nowMs = Date.now()): History {
	const byDay = new Map<string, Acc>();
	let chars = 0;
	let errors = 0;
	let ms = 0;
	let undated = 0;

	for (const r of rows) {
		chars += r.chars;
		errors += r.errors;
		ms += r.ms;
		if (!r.atMs) {
			undated += 1;
			continue; // in the totals, out of the chart
		}
		const key = dayKey(r.atMs);
		const d = byDay.get(key) ?? { day: key, atMs: r.atMs, sessions: 0, chars: 0, errors: 0, ms: 0 };
		d.sessions += 1;
		d.chars += r.chars;
		d.errors += r.errors;
		d.ms += r.ms;
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
			wpm: wpmOf(d.chars, d.ms),
			errPct: d.chars ? Math.round((d.errors / d.chars) * 1000) / 10 : 0,
		}))
		.sort((a, b) => (a.day < b.day ? 1 : -1));

	return {
		days,
		sessions: rows.length,
		chars,
		minutes: Math.round(ms / 60000),
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
 * One point per day for the sparkline, oldest left. `limit` keeps the chart readable on a phone; the
 * totals are unaffected, because they come from `history`, not from what is drawn.
 */
export function series(h: History, limit = 30): { day: string; wpm: number; minutes: number }[] {
	const take = h.days.slice(0, limit); // days arrive newest-first
	// Oldest-left for drawing, indexed rather than reversed: mutating a copy reads as safe and is the
	// thing a reviewer has to re-check, while this cannot touch h.days at all.
	return take.map((_, i) => {
		const d = take[take.length - 1 - i]!;
		return { day: d.day, wpm: d.wpm, minutes: d.minutes };
	});
}
