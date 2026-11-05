import { describe, expect, it } from "vitest";
import { crossed, insightPanel } from "../src/stats/panel.ts";
import { inOrder, keyDelta, speedLoss, trends, hesitation, type KeyTrend } from "../src/stats/insights.ts";
import { type SessionRow, tidAt } from "../src/atproto/records.ts";
import type { StatMap } from "../src/stats/stats.ts";

const DAY = 86_400_000;
const GOAL_CPM = 240; // 48 wpm -> 250 ms per key
const GOAL_MS = 250;

/** A row whose stats are a snapshot of `key -> {ms, samples}` at that moment. */
const row = (i: number, stats: StatMap, over: Partial<SessionRow> = {}): SessionRow => ({
	rkey: `r${String(i).padStart(4, "0")}`,
	layout: "go60+qwerty",
	atMs: Date.now() - (40 - i) * DAY,
	chars: 100,
	errors: 0,
	ms: 60_000,
	stats,
	...over,
});

/** Typing one key `k` times at `ms`, the way the lesson engine accumulates it. */
const bumpTo = (prev: StatMap[string] | undefined, ms: number, k: number): StatMap[string] => {
	let t = prev?.ttMs16 ?? 0;
	const samples = prev?.samples ?? 0;
	for (let i = 0; i < k; i += 1) t = samples + i === 0 ? ms * 16 : t + (ms * 16 - t) / 16;
	return { ttMs16: Math.round(t), samples: samples + k, errors: prev?.errors ?? 0 };
};

const one = (id: string, stat: StatMap[string]): StatMap => ({ [id]: stat });

describe("per-session recovery from cumulative snapshots", () => {
	it("gets the session's own speed back out of the running mean", () => {
		// The records store a cumulative EWMA. Diffing two of them is the only way to chart a single session,
		// and the whole panel rests on this inversion being exact.
		const a = row(0, one("f", { ttMs16: 400 * 16, samples: 50, errors: 0 }));
		const b = row(1, one("f", bumpTo(a.stats.f, 200, 10)), { chars: 10 });
		expect(keyDelta(a.stats.f, b.stats.f).ms).toBe(200);
		expect(keyDelta(a.stats.f, b.stats.f).strokes).toBe(10);
	});

	it("is exact even for a single stroke, where the stored value barely moved", () => {
		const a = row(0, one("f", { ttMs16: 400 * 16, samples: 50, errors: 0 }));
		const b = row(1, one("f", bumpTo(a.stats.f, 200, 1)));
		expect(keyDelta(a.stats.f, b.stats.f).ms).toBe(200);
	});

	it("reports a key as unmoved when its sample count did not change", () => {
		const a = row(0, one("f", { ttMs16: 400 * 16, samples: 50, errors: 1 }));
		const b = row(1, one("f", { ttMs16: 400 * 16, samples: 50, errors: 1 }));
		const d = keyDelta(a.stats.f, b.stats.f);
		expect(d.moved).toBe(false);
		expect(d.strokes).toBe(0);
	});

	it("treats a key's first appearance as that session's own mean, since there is nothing to subtract", () => {
		const a = row(0, {});
		const b = row(1, one("q", { ttMs16: 300 * 16, samples: 4, errors: 0 }));
		const d = keyDelta(a.stats.q, b.stats.q);
		expect(d.moved).toBe(true);
		expect(d.ms).toBe(300);
	});

	it("reports a track for a key struck once per session, and none for a key nobody struck", () => {
		// Three sessions where `z` sits unchanged in the snapshot: a chart that plotted those as three points
		// would claim a flat line for a key the learner never typed. The counterpart below is the same key with
		// one stroke added each session, which must produce a real track.
		const idle = { ttMs16: 500 * 16, samples: 20, errors: 0 };
		expect(trends([row(0, one("z", idle)), row(1, one("z", idle)), row(2, one("z", idle))], GOAL_MS)).toEqual(emptyTrend());
		let stat = idle;
		const moving = [row(0, one("z", stat))];
		for (let i = 1; i <= 3; i += 1) {
			stat = bumpTo(stat, 400, 1);
			moving.push(row(i, one("z", stat)));
		}
		const z = findKey(trends(moving, GOAL_MS), "z");
		expect(z.sessions).toBe(4);
	});

	it("never puts a session that happened earlier second, even when both share a millisecond", () => {
		// rkey is the last word for two sessions in the same instant. Reversing it reorders a track that the
		// charts draw as a path, and the first coordinate becomes the last day.
		const at = Date.now();
		const a = row(1, one("z", { ttMs16: 500 * 16, samples: 100, errors: 0 }), { atMs: at, rkey: "aaa" });
		const b = row(2, one("z", bumpTo(a.stats.z, 200, 20)), { atMs: at, rkey: "zzz" });
		expect(inOrder([b, a]).map((r) => r.rkey)).toEqual(["aaa", "zzz"]);
		const z = findKey(trends(inOrder([a, b]), GOAL_MS), "z");
		expect(z.firstMs).toBe(500); // reversed order would read the 200 ms end as the start
	});

	it("orders undated sessions among themselves by rkey", () => {
		const rows = [row(0, {}, { atMs: 0, rkey: "bbb" }), row(0, {}, { atMs: 0, rkey: "aaa" })];
		expect(inOrder(rows).map((r) => r.rkey)).toEqual(["aaa", "bbb"]);
	});

	it("keeps an undated session at the end instead of dropping it in 1970", () => {
		// atMs 0 means "no readable tid", not "January 1970". Sorting it as a time would move a real record to
		// the front of every track, so the comparator has to notice that one side has no date at all.
		const dated = row(0, {}, { atMs: Date.now() - 3 * DAY });
		const undated = row(1, {}, { atMs: 0 });
		expect(inOrder([undated, dated]).map((r) => r.atMs)).toEqual([dated.atMs, 0]);
		expect(inOrder([dated, undated]).map((r) => r.atMs)).toEqual([dated.atMs, 0]);
	});

	it("puts a real tid before a hand-written key that sorts lower", () => {
		// Sessions pruned and re-created, or a demo row beside a synced one: a plain counter rkey like "r1"
		// sorts below every tid, so a time-first comparison is what keeps the sequence honest.
		const early = tidAt(Date.now() - 5 * DAY);
		const a = row(0, {}, { atMs: Date.now() - 5 * DAY, rkey: early });
		const b = row(1, {}, { atMs: Date.now() - 2 * DAY, rkey: "r1" });
		expect(inOrder([b, a]).map((r) => r.atMs)).toEqual([a.atMs, b.atMs]);
	});
});

/** A key's trend, from whichever bucket it landed in. Throws when it has no track at all. */
function findKey(t: { improving: KeyTrend[]; plateaued: KeyTrend[]; slowing: KeyTrend[] }, id: string): KeyTrend {
	const found = [...t.improving, ...t.plateaued, ...t.slowing].find((k) => k.keyId === id);
	if (!found) throw new Error(`no track for ${id} in this fixture`);
	return found;
}

/** No key had a track at all. */
const emptyTrend = () => ({ improving: [], plateaued: [], slowing: [] });

describe("trends", () => {
	it("calls a key that got faster improving", () => {
		// A real plateau then improvement, and it ends above the 250 ms goal. Starting from samples 0 would
		// be dishonest: observe() initialises the mean directly, which the inversion below reads as one
		// enormous first-session improvement, so the track has to begin settled.
		let stat = { ttMs16: 500 * 16, samples: 200, errors: 0 };
		const rows = [row(0, one("j", stat))];
		for (let i = 1; i <= 8; i += 1) {
			stat = bumpTo(stat, 500, 15); // holding
			rows.push(row(i, one("j", stat)));
		}
		for (let i = 9; i <= 14; i += 1) {
			stat = bumpTo(stat, 340, 15); // improving, still above goal
			rows.push(row(i, one("j", stat)));
		}
		const t = trends(inOrder(rows), GOAL_MS);
		expect(t.improving.map((k) => k.keyId)).toContain("j");
		expect(findKey(t, "j").lastMs).toBeGreaterThan(GOAL_MS);
	});

	it("files a key that is already under goal as settled, not as still improving", () => {
		// The contradiction this prevents: the same letter named in "getting faster" and "reached the goal"
		// two cards apart. The drift here is large (400 ms down to 150) so that the bucket is decided by the
		// goal, not by a threshold the fixture happens to sit under.
		let stat = { ttMs16: 400 * 16, samples: 200, errors: 0 };
		const rows = [row(0, one("a", stat))];
		for (let i = 1; i <= 10; i += 1) {
			stat = bumpTo(stat, i <= 4 ? 400 : 150, 40);
			rows.push(row(i, one("a", stat)));
		}
		const t = trends(inOrder(rows), GOAL_MS);
		const a = findKey(t, "a");
		expect(a.drift).toBeGreaterThan((a.firstMs * 50) / 100 / 2); // the slope alone would call this improving
		expect(t.improving.map((k) => k.keyId)).not.toContain("a");
		expect(t.plateaued.map((k) => k.keyId)).toContain("a");
	});
});

describe("hesitation", () => {
	it("separates finger speed from the clock, and the gap is the pausing", () => {
		// 100 seconds of wall clock, but the keystrokes themselves only cost 30: 70 went *between* keys.
		// That is the number no line chart can show.
		const a = row(0, one("a", { ttMs16: 300 * 16, samples: 100, errors: 0 }));
		const b = row(1, one("a", bumpTo(a.stats.a, 300, 100)), { chars: 100, ms: 100_000 });
		const h = hesitation([a, b]);
		expect(h.points[1].pausedShare).toBe(70);
		const s = speedLoss(h.points);
		expect(s.strokeWpm).toBeGreaterThan(s.wpm);
		expect(s.lost).toBeGreaterThan(0);
	});

	it("never reports negative pausing when the snapshot disagrees with the count", () => {
		// A merged record can carry a mean that implies more stroke time than the session lasted.
		const rows = [
			row(0, one("a", { ttMs16: 900 * 16, samples: 0, errors: 0 })),
			row(1, one("a", { ttMs16: 900 * 16, samples: 100, errors: 0 }), { chars: 100, ms: 20_000 }),
		];
		const h = hesitation(rows);
		expect(h.points.every((p) => p.pausedShare >= 0)).toBe(true);
	});
});

describe("crossed", () => {
	it("dates a key from its first appearance, judged on the mean of every stroke it has", () => {
		const a = row(0, one("g", { ttMs16: 200 * 16, samples: 400, errors: 0 }));
		const b = row(1, one("g", bumpTo(a.stats.g, 200, 40)));
		const c = crossed(inOrder([a, b]), GOAL_MS);
		expect(c).toHaveLength(1);
		expect(c[0].keyId).toBe("g");
		expect(c[0].sessions).toBe(1);
	});

	it("does not credit a key whose first record is still above goal", () => {
		const rows = [row(0, one("h", { ttMs16: 700 * 16, samples: 400, errors: 0 }))];
		expect(crossed(inOrder(rows), GOAL_MS)).toHaveLength(0);
	});

	it("does not credit a mean built from a couple of keystrokes", () => {
		const rows = [row(0, one("v", { ttMs16: 100 * 16, samples: 3, errors: 0 }))];
		expect(crossed(inOrder(rows), GOAL_MS)).toHaveLength(0);
	});

	it("says nothing when the goal is not set", () => {
		expect(crossed([row(0, one("a", { ttMs16: 100 * 16, samples: 400, errors: 0 }))], 0)).toEqual([]);
	});
});

describe("panel", () => {
	const stats: StatMap = {
		a: { ttMs16: 200 * 16, samples: 500, errors: 5 },
		q: { ttMs16: 900 * 16, samples: 120, errors: 30 },
	};

	it("explains itself when nothing has settled, without denying that keys are slipping", () => {
		// The sentences this replaces used to contradict the rows underneath them: "nothing has settled" printed
		// next to a list of slipping keys. One key holds, then slows -- so nothing is settled, and the card has
		// to say so rather than implying the history is flat.
		const slow = [row(0, one("q", { ttMs16: 400 * 16, samples: 200, errors: 0 }))];
		for (let i = 1; i <= 10; i += 1) {
			slow.push(row(i, one("q", bumpTo(slow[i - 1].stats.q, i <= 5 ? 400 : 620, 20))));
		}
		const cards = insightPanel(slow, GOAL_CPM);
		const t = cards.find((c) => c.id === "trends");
		expect(t?.rows?.map((r) => r.label)).toContain("q");
		expect(t?.body ?? "").toMatch(/slipping/i);
	});

	it("returns three history cards, and none of them repeats the key bars", () => {
			// "Slowest right now" was here, and it restated the bars on the screen directly above it in a worse
			// format. The panel's whole claim to exist is that it says things the chart and the bars cannot.
			const cards = insightPanel([row(0, stats, { atMs: 0 })], GOAL_CPM);
			expect(cards.map((c) => c.id)).toEqual(["hesitation", "trends", "milestones"]);
		});

	it("explains itself with no data instead of showing nothing", () => {
		for (const c of insightPanel([], GOAL_CPM)) expect(c.body || c.rows?.length).toBeTruthy();
	});

	it("does not claim a hesitation number it cannot derive", () => {
		// One session is not a trend, and the card would be quoting a single sample as if it were a rate.
		const cards = insightPanel([row(0, one("a", { ttMs16: 300 * 16, samples: 50, errors: 0 }))], GOAL_CPM);
		expect(cards.find((c) => c.id === "hesitation")?.stat).toBeUndefined();
	});

	it("never prints a stat the copy then contradicts", () => {
		for (const c of insightPanel([], GOAL_CPM)) {
			if (c.stat === undefined) continue;
			expect(c.body ?? "", c.id).not.toMatch(/nothing|no key|not listed/i);
		}
	});
});
