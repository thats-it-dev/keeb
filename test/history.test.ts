import { describe, expect, it } from "vitest";
import { dayKey, history, series } from "../src/stats/history.ts";
import type { SessionRow } from "../src/atproto/records.ts";

// Local noon N CALENDAR days ago, via setDate rather than N x 86,400,000 ms. The difference is not cosmetic:
// the week the clocks change, a 24-hour subtraction lands a day off, and series() walks the calendar, so
// the two disagreed and every span assertion below drifted by one day for a few days each year.
const noon = (daysAgo: number) => {
	const d = new Date();
	d.setDate(d.getDate() - daysAgo);
	d.setHours(12, 0, 0, 0);
	return d.getTime();
};
const s = (over: Partial<SessionRow> & { atMs: number }): SessionRow => ({
	rkey: over.rkey ?? `rkey-${over.atMs}`,
	layout: "go60+qwerty",
	chars: 500,
	errors: 0,
	ms: 60_000,
	stats: {},
	...over,
});

describe("history", () => {
	it("pools characters over time rather than averaging the session speeds", () => {
		// The distinction is not academic. A 30-second burst and a 5-minute trudge are both "sessions", and
		// averaging their speeds reports 22 wpm for the whole history when the fingers actually produced 7.
		// They sit on different days on purpose: two sessions in one day would pool inside the day bucket
		// and the two definitions would agree, which is exactly how this test first passed a mutant.
		const h = history([s({ atMs: noon(0), chars: 100, ms: 30_000 }), s({ atMs: noon(1), chars: 100, ms: 300_000 })]);
		expect(h.days.length).toBe(2);
		expect(h.wpm).toBe(7); // 200 chars / 330s = 36 cpm = 7 wpm
		expect(h.days.map((d) => d.wpm).sort((a, b) => a - b)).toEqual([4, 40]);
		expect(Math.round((4 + 40) / 2)).toBe(22); // the wrong answer, spelled out so nobody re-derives it
	});

	it("pools within a day too", () => {
		const h = history([s({ atMs: noon(0), chars: 100, ms: 30_000 }), s({ atMs: noon(0), chars: 100, ms: 300_000 })]);
		expect(h.days.length).toBe(1);
		expect(h.days[0]?.wpm).toBe(7);
	});

	it("buckets by local calendar day, not UTC", () => {
		const late = new Date(Date.now());
		late.setHours(23, 30, 0, 0);
		const early = new Date(Date.now());
		early.setHours(0, 30, 0, 0);
		const h = history([s({ atMs: early.getTime() }), s({ atMs: late.getTime() })]);
		expect(h.days.length).toBe(dayKey(early.getTime()) === dayKey(late.getTime()) ? 1 : 2);
		expect(h.days.map((d) => d.day)).toContain(dayKey(late.getTime()));
	});

	it("orders days newest first", () => {
		const h = history([s({ atMs: noon(3) }), s({ atMs: noon(0) }), s({ atMs: noon(1) })]);
		expect(h.days.length).toBe(3);
		expect(h.days[0]?.day).toBe(dayKey(noon(0)));
		expect(h.days[2]?.day).toBe(dayKey(noon(3)));
	});

	it("counts a session with no readable date in the totals but not on the chart", () => {
		// An rkey that will not decode (another client wrote it) must not steal the row from the numbers,
		// and must not land on today's bar either.
		const h = history([s({ atMs: 0, chars: 900, ms: 90_000 }), s({ atMs: noon(0) })]);
		expect(h.undated).toBe(1);
		expect(h.days.length).toBe(1);
		expect(h.chars).toBe(1400);
		expect(h.sessions).toBe(2);
	});

	it("streaks consecutive days and tolerates a blank yesterday", () => {
		expect(history([s({ atMs: noon(0) }), s({ atMs: noon(1) }), s({ atMs: noon(2) })]).streak).toBe(3);
		// Nothing yesterday but a run before that: the streak is 1, because today alone keeps it alive.
		expect(history([s({ atMs: noon(0) }), s({ atMs: noon(2) })]).streak).toBe(1);
		// Yesterday counts as unbroken: a reader who checks at 00:05 has not had the chance to practise.
		expect(history([s({ atMs: noon(1) }), s({ atMs: noon(2) })]).streak).toBe(2);
		expect(history([s({ atMs: noon(5) })]).streak).toBe(0);
	});

	it("breaks a streak across a month boundary", () => {
		const mar1 = new Date(2026, 2, 1, 12).getTime();
		const feb28 = new Date(2026, 1, 28, 12).getTime();
		const h = history([s({ atMs: mar1 }), s({ atMs: feb28 })]);
		expect(h.days.length).toBe(2);
		// Not a streak relative to today, but the two days are adjacent: assert the arithmetic that
		// prevDay uses, rather than trusting setDate to have behaved.
		expect(h.days.some((d) => d.day === dayKey(mar1))).toBe(true);
		expect(dayKey(feb28)).toBe("2026-02-28");
	});

	it("reports the best day by speed, not by volume", () => {
		// 10 minutes at 40 wpm vs one minute at 80 wpm: the longer day typed more characters, and the
		// faster day is the one worth calling a best.
		const h = history([s({ atMs: noon(1), chars: 2000, ms: 600_000 }), s({ atMs: noon(0), chars: 400, ms: 60_000 })]);
		expect(h.days[0]?.wpm).toBe(80);
		expect(h.best?.day).toBe(dayKey(noon(0)));
		expect(h.best?.wpm).toBe(80);
	});

	it("says nothing is available when there is nothing", () => {
		const h = history([]);
		expect(h.days).toEqual([]);
		expect(h.chars).toBe(0);
		expect(h.wpm).toBe(0);
		expect(h.streak).toBe(0);
		expect(h.best).toBeUndefined();
	});

	it("handles a session that recorded time but no characters", () => {
		const h = history([s({ atMs: noon(0), chars: 0, ms: 45_000 })]);
		expect(h.wpm).toBe(0); // not Infinity, which is what a bare chars/ms division would give
		expect(h.minutes).toBe(1);
		expect(h.undated).toBe(0);
	});

	it("returns the day window oldest-left and capped, without touching the totals", () => {
		const rows = Array.from({ length: 50 }, (_, i) => s({ atMs: noon(i) }));
		const h = history(rows);
		const pts = series(h, 30);
		expect(pts.length).toBe(30);
		expect(pts[0]?.day).toBe(dayKey(noon(29))); // oldest of the newest 30
		expect(pts[29]?.day).toBe(dayKey(noon(0))); // today, on the right
		expect(h.sessions).toBe(50); // the cap is a drawing decision, not a data one
	});

	it("spans calendar days, so a skipped day is a point with nothing in it", () => {
		// A series indexed by which days HAVE data is the bug this guards: nine sessions across eleven days
		// would draw as nine adjacent bars and read as an unbroken run of practice.
		const h = history([s({ atMs: noon(0) }), s({ atMs: noon(4) })]);
		const pts = series(h);
		expect(pts.length).toBe(5);
		expect(pts.map((p) => p.sessions)).toEqual([1, 0, 0, 0, 1]);
		expect(pts.map((p) => p.wpm)).toEqual([pts[0]!.wpm, 0, 0, 0, pts[4]!.wpm]);
	});

	it("anchors on the newest day with data rather than today", () => {
		// Checking the chart at 00:05 should not pad the right edge with empty days and shrink the bars.
		const h = history([s({ atMs: noon(1) }), s({ atMs: noon(2) })]);
		const pts = series(h);
		expect(pts.length).toBe(2);
		expect(pts[1]!.sessions).toBe(1);
	});

	it("leaves the days array alone when building a series", () => {
		const h = history([s({ atMs: noon(0) }), s({ atMs: noon(1) })]);
		const before = h.days.map((d) => d.day);
		series(h);
		expect(h.days.map((d) => d.day)).toEqual(before);
	});
});

describe("the typing-only line", () => {
	// One session per day, first appearance of the key: then the snapshot IS the session, and the stroke
	// time is samples x mean. That is the arithmetic the shaded band between the two lines is drawn from.
	const typed = (daysAgo: number, strokes: number, msEach: number, wallMs: number) =>
		s({ atMs: noon(daysAgo), chars: strokes, ms: wallMs, stats: { a: { ttMs16: Math.round(msEach * 16), samples: strokes, errors: 0 } } });

	it("is the same characters over less time, so it never sits below the clock line", () => {
		const h = history([typed(0, 100, 300, 60_000)]);
		expect(h.days[0]!.wpm).toBe(20); // 100 chars over 60 s
		expect(h.days[0]!.strokeWpm).toBe(40); // the same 100 chars over the 30 s they actually took
		expect(h.days[0]!.strokeWpm).toBeGreaterThanOrEqual(h.days[0]!.wpm);
	});

	it("clamps at the wall clock, because stroke time cannot exceed the session that contained it", () => {
		// A merged record can carry a mean that implies more keystroke time than the session lasted. The
		// band would otherwise be drawn upside down, or the line would run off the top of the chart.
		const h = history([typed(0, 100, 900, 10_000)]);
		expect(h.days[0]!.strokeWpm).toBe(h.days[0]!.wpm);
		expect(h.days[0]!.strokeMinutes).toBeLessThanOrEqual(h.days[0]!.minutes);
	});

	it("pools characters over stroke time across a day rather than averaging the sessions", () => {
		// Same shape as the clock line's rule, and the same trap: a short fast session and a long slow one
		// are not two equal votes about how the day went.
		const day = noon(0);
		const rows = [s({ atMs: day, chars: 20, ms: 6_000, stats: { a: { ttMs16: 100 * 16, samples: 20, errors: 0 } } }), s({ atMs: day, chars: 200, ms: 60_000, stats: { a: { ttMs16: 250 * 16, samples: 200, errors: 0 } } })];
		// Both fixtures above share an rkey, which real records cannot do. That is the point of the second
		// assertion: a stroke map keyed by rkey would hand one session's number to both and double-count it.
		const h = history(rows);
		expect(h.days[0]!.strokeWpm).toBe(Math.round(220 / (47_000 / 60000) / 5)); // 20 strokes at 100 ms, then 180 more at 250 ms
		expect(h.days[0]!.strokeWpm).toBeLessThan(Math.round(220 / (2000 / 60000) / 5)); // not the first session's timing reused
		expect(h.days[0]!.sessions).toBe(2);
	});

	it("measures nothing for a session that carries no per-key stats", () => {
		// Records from before stats existed, and any row seeded without them. The honest output is 0, which
		// makes the chart draw the clock line and leave the band out -- the alternative is to shade the whole
		// area under the curve as "time not typing", which is a claim about the data rather than the data.
		const h = history([s({ atMs: noon(0), chars: 100, ms: 60_000 })]);
		expect(h.days[0]!.strokeWpm).toBe(0);
		expect(series(h)[0]!.strokeWpm).toBe(0);
	});

	it("counts an undated session in the totals but on no day", () => {
		const h = history([s({ atMs: 0, chars: 100, ms: 60_000, stats: { a: { ttMs16: 300 * 16, samples: 100, errors: 0 } } }), typed(1, 100, 300, 60_000)]);
		expect(h.days).toHaveLength(1);
		expect(h.strokeWpm).toBeGreaterThan(0);
		expect(h.strokeWpm).toBeGreaterThanOrEqual(h.wpm);
	});
});
