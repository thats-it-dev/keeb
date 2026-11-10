// The one-day view: how much practice time today holds, and how far that is from the daily goal.
//
// Like history.ts, this file is pure. The minutes come from the local daily tally rather than from the
// synced session rows, because a day's practice must read correctly before anything has synced — and for a
// learner without an account, the session rows never arrive at all.

import { dayKey } from "./history.ts";

/** One local calendar day of practice. The store keeps one row per day, keyed by `day`. */
export type DailyRow = { day: string; ms: number };

/** A day is kept in the tally this long. Today is all the bar reads; the rest is insurance against a row
 *  written just before midnight landing in a later fold. */
export const KEEP_DAYS = 7;

/** Practice minutes spent today. `liveMs` is the session still open on screen — its keystroke time,
 *  capped — so the number moves while the learner types and stalls within seconds when they stop. */
export function todayMs(rows: DailyRow[], nowMs: number, liveMs = 0): number {
	const day = dayKey(nowMs);
	let ms = 0;
	for (const r of rows) if (r && r.day === day && Number.isFinite(r.ms) && r.ms > 0) ms += r.ms;
	return ms + Math.max(0, liveMs);
}

/** Add `ms` to today's row and drop days older than the window, sorted by day. */
export function foldDaily(rows: DailyRow[], nowMs: number, ms: number): DailyRow[] {
	const cutoff = new Date(nowMs);
	cutoff.setDate(cutoff.getDate() - (KEEP_DAYS - 1));
	const day = dayKey(nowMs);
	const kept: DailyRow[] = rows
		.filter((r) => r && r.day >= dayKey(cutoff.getTime()) && Number.isFinite(r.ms) && r.ms > 0)
		.map((r) => ({ day: r.day, ms: r.ms }));
	const mine = kept.find((r) => r.day === day);
	if (mine) mine.ms += Math.max(0, ms);
	else if (ms > 0) kept.push({ day, ms });
	return kept.sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** The day's progress. Minutes are keystroke time — charged sessions plus the open session's capped
 *  gaps (see SessionRecorder.elapsed) — so the number grows with the fingers, not with the clock. */
export type DailyGoal = {
	/** Whole minutes practised today. Floored: a bar that says 15/15 must mean the goal was reached. */
	minutes: number;
	/** The goal as the learner set it, in minutes. 0 turns the bar off. */
	goalMinutes: number;
	/** 0-100, clamped at the goal so a finished day reads as full, not as a scoreboard. */
	pct: number;
	reached: boolean;
};

export function dailyGoal(rows: DailyRow[], nowMs: number, liveMs: number, goalMin: number): DailyGoal {
	const ms = todayMs(rows, nowMs, liveMs);
	const goalMs = Math.max(0, goalMin) * 60_000;
	return {
		minutes: Math.floor(ms / 60_000),
		goalMinutes: Math.max(0, goalMin),
		// Floored, not rounded: a bar that reads 100% must mean the goal is met, or the bar and the
		// "goal reached" word underneath it can disagree for one second short of a minute.
		pct: goalMs <= 0 ? 0 : Math.min(100, Math.floor((ms / goalMs) * 100)),
		reached: goalMs > 0 && ms >= goalMs,
	};
}
