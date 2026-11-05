// What goes inside the insight panel: the sentences, in priority order.
//
// The panel is built here as plain data rather than markup so the claims are testable without mounting a
// component. Every number has to survive the same question: would it still be true if the data were
// missing? So a card says "not enough sessions yet" instead of inventing a zero.

import type { SessionRow } from "../atproto/records.ts";
import { hesitation, speedLoss, trends, type KeyTrend } from "./insights.ts";
import { targetTimeMs } from "./stats.ts";

export type PanelCard = { id: string; title: string; body: string; stat?: string; sub?: string; rows?: { label: string; detail: string }[] };

/** Half of them stuck, half of them improving, and one slow one to practise. */
const MIN_TRACK_SESSIONS = 4;

/** Demo rows carry no timestamps, so no insight that depends on "when" can be drawn from them. */
const dated = (rows: SessionRow[]): SessionRow[] => rows.filter((r) => r.atMs > 0);

export function insightPanel(rows: SessionRow[], targetCpm: number): PanelCard[] {
	const timed = dated(rows);
	const cards: PanelCard[] = [];

	// 1. Hesitation. The chart now draws this as the band between its two lines; the card states how big the
	// band is as one number, because a shaded gap is hard to compare week to week and a number is not.
	const hes = hesitation(timed);
	const loss = speedLoss(hes.points);
	if (hes.points.length >= 3) {
		cards.push({
			id: "hesitation",
			title: "Where the time goes",
			stat: `${loss.lost} wpm`,
			sub: "lost to pausing, not to slow fingers",
			body: `Typing at your own key speed would be about ${loss.strokeWpm} wpm. The clock says ${loss.wpm}. Across ${hes.points.length} sessions, ${hes.avgPausedShare}% of each one was spent between keystrokes.`,
		});
	} else {
		cards.push({
			id: "hesitation",
			title: "Where the time goes",
			body: timed.length
				? `Needs a few more dated sessions to split finger speed from pausing. ${timed.length} so far.`
				: "Sessions are on their way, but none carry a readable date, so there is nothing to split.",
		});
	}

	// 2. Per-key trends. This is the answer to "is this key still getting better".
	const goalMs = targetTimeMs(targetCpm);
	const tr = trends(timed, goalMs);
	if (tr.improving.length + tr.plateaued.length + tr.slowing.length > 0) {
		const rowsOut: { label: string; detail: string }[] = [];
		for (const k of tr.improving.slice(0, 3)) rowsOut.push({ label: k.keyId, detail: gain(k) });
		for (const k of tr.slowing.slice(0, 2)) rowsOut.push({ label: k.keyId, detail: `slipped ${k.firstMs} → ${k.lastMs} ms` });
		const stuck = tr.plateaued.filter((k) => k.sessions >= MIN_TRACK_SESSIONS).slice(0, 3);
		const done = tr.plateaued.filter((k) => k.ms <= goalMs).slice(0, 3);
		cards.push({
			id: "trends",
			title: "Keys that moved",
			body: done.length
				? `At goal and holding: ${done.map((k) => `${k.keyId} at ${k.ms} ms`).join(", ")}. These need reps to stay, not work to get faster.`
				: stuck.length
					? `Flattened out: ${stuck.map((k) => `${k.keyId} at ${k.ms} ms`).join(", ")}. Still struck, no longer faster — the point to change how you practise them, not how often.`
					: tr.slowing.length
						? "Nothing has settled, but some keys are slipping. See the rows below."
						: tr.slowing.length
						? "Nothing has settled, and some keys are slipping — see the list below."
						: "Nothing is settled, slipping, or still climbing — the tracks are too short to tell yet.",
			rows: rowsOut,
		});
	} else {
		cards.push({ id: "trends", title: "Keys that moved", body: "No key has enough history yet to have a direction." });
	}

	// 3. Goal crossings: the milestones the ladder is built on, dated from the snapshots.
	const marks = crossed(timed, goalMs).slice(-6);
	const fmtDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
	cards.push(
		marks.length
			? {
							id: "milestones",
							title: "Keys you reached",
							stat: `${marks.length}`,
							sub: `first recorded under ${goalMs} ms`,
							rows: marks.map((m) => ({ label: m.keyId, detail: fmtDay.format(new Date(m.atMs)) })),
							body: `Judged on the mean of every stroke typed on the key, and dated to when it first enters the history the repo still keeps. A key learnt before that window is credited here too, because its records still say it was fast.`,
						}
					: { id: "milestones", title: "Keys you reached", body: `Nothing in this history starts out under ${goalMs} ms. Either you are still on the first keys, or the records that would show it have been pruned.` },
	);

	return cards;
}

function gain(k: KeyTrend): string {
	const pct = k.firstMs > 0 ? Math.round((100 * (k.firstMs - k.lastMs)) / k.firstMs) : 0;
	return `${k.firstMs} → ${k.lastMs} ms (${pct}% faster)`;
}

/**
 * When each key was already fast enough to count as learned.
 *
 * The date is when that key first appears in the retained history, and the measure is the running mean on
 * that record: every stroke ever typed on it, which is what "can you do it" means. Three sessions in a row
 * would have been the naive version of this, and it is wrong twice -- a key that had already settled reports
 * nothing at all, and the last session where the delta happens to dip under the goal is not when it was
 * learnt. Watching a 1/16-weighted cumulative mean "cross" a line measures noise, not a milestone.
 */
export function crossed(rows: SessionRow[], goalMs: number): { keyId: string; atMs: number; sessions: number }[] {
	if (goalMs <= 0) return [];
	const timed = dated(rows);
	// A key is judged by the running mean stored on its FIRST record, which is the average of every stroke
	// the learner has ever typed on it. The old rule watched the trajectory cross a line, but a cumulative
	// mean that had already settled before our window begins never crosses anything in it -- so a learner
	// who got good at `a` two months ago would never be credited for `a`, and the card reported a session
	// number that the data did not support.
	const settled = new Map<string, { atMs: number; sessions: number }>();
	for (let i = 0; i < timed.length; i += 1) {
		const prev = i > 0 ? timed[i - 1].stats : undefined;
		for (const [id, stat] of Object.entries(timed[i].stats)) {
			if (prev?.[id]?.samples) continue; // not this key's first appearance in the window
			if (stat.samples < MIN_CREDIT_SAMPLES) continue;
			const ms = Math.round(stat.ttMs16 / 16);
			if (ms > 0 && ms <= goalMs) settled.set(id, { atMs: timed[i].atMs, sessions: i + 1 });
		}
	}
	return [...settled].map(([keyId, v]) => ({ keyId, ...v })).sort((a, b) => a.atMs - b.atMs || (a.keyId < b.keyId ? -1 : 1));
}

/** A mean built from two keystrokes is not evidence that a key was ever learned. */
const MIN_CREDIT_SAMPLES = 30;
