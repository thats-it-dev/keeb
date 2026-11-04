// Fake practice sessions, for preview builds and for anyone who wants to see what the history chart looks
// like before they have typed anything.
//
// Two rules, both about honesty:
//
// 1. This data is never persisted and never synced. It is generated at render time and lives only in the
//    component's memory, so a preview visit cannot leak a fake session into a real repo or a real device's
//    IndexedDB.
// 2. Whatever draws it must say so. See the banner in #history(): a chart that looks like progress and is
//    not progress is the one failure mode this whole screen has been avoiding.
//
// Deterministic per seed, so the same preview URL always shows the same curve and a screenshot in a PR
// body is reproducible.

import type { SessionRow } from "../atproto/records.ts";

const MAX_SESSIONS = 50; // matches the cap the real records are pruned to, so the caption stays true

/** mulberry32: small, deterministic, and good enough to make a plausible-looking practice curve. */
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * A learner practising for `days` days: an upward trend, day-to-day noise, and days they skipped. Rest days
 * are the point of the generator -- a curve with no gaps would make the chart's break-on-empty-day rule
 * impossible to see on a preview, which is the only reason to draw fake data at all.
 */
export function demoSessions(layout: string, opts: { seed?: number; days?: number; nowMs?: number } = {}): SessionRow[] {
	const { seed = 20261104, days = 42, nowMs = Date.now() } = opts;
	const r = rng(seed);
	const rows: SessionRow[] = [];
	for (let ago = days - 1; ago >= 0; ago -= 1) {
		if (r() < 0.28) continue; // a day off, roughly one in four
		// Slowly improving, with a bad-day wobble. Capped well below anything a real fast typist reaches,
		// so a screenshot never implies the app is claiming 300 wpm.
		const wpm = Math.round(16 + (days - 1 - ago) * 0.75 + (r() - 0.5) * 6);
		const sessions = 1 + (r() < 0.3 ? 1 : 0);
		for (let s = 0; s < sessions; s += 1) {
			const minutes = 5 + Math.floor(r() * 12);
			const atMs = noonDaysAgo(ago, nowMs) + s * 3_600_000;
			// chars follows from wpm and minutes by definition (5 characters to a word), so the derived
			// speed on the chart equals the ramp above instead of drifting from it.
			const chars = wpm * 5 * minutes;
			rows.push({
				rkey: `demo-${rows.length}`,
				layout,
				atMs,
				chars,
				errors: Math.round(chars * (0.004 + r() * 0.02)),
				// Rounded like every other number here: a float is what the atproto data model cannot carry, and
				// a generator that drifts from the shape of real rows would stop being a test of that shape.
				ms: Math.round((minutes + r()) * 60_000),
			});
		}
	}
	return rows.sort((a, b) => a.atMs - b.atMs).slice(-MAX_SESSIONS);
}

/** Midday, `ago` days back, so a generated session never lands on the wrong side of a local midnight. */
function noonDaysAgo(ago: number, nowMs: number): number {
	const d = new Date(nowMs);
	d.setDate(d.getDate() - ago);
	d.setHours(12, 0, 0, 0);
	return d.getTime();
}

/**
 * Is this build being served from a Pages preview rather than the app's own domain? Preview deploys are the
 * same artifact as production, so import.meta.env cannot tell them apart and the hostname is the only
 * signal. Matched on the app name so the template keeps working for the next app.
 */
export function isPreviewHost(host: string, app: string): boolean {
	const suffix = `.${app}.pages.dev`;
	if (!host.endsWith(suffix)) return false;
	// What is left must be exactly one label: a branch name or a deploy hash. "a.b.keeb.pages.dev" is not a
	// preview of this app, and a host built to end in the right characters still has to have the shape.
	const branch = host.slice(0, host.length - suffix.length);
	return branch.length > 0 && !branch.includes(".") && !branch.includes("@");
}
