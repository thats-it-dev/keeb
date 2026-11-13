// Who gets charged when a practice session closes, how often, and how much. The tally arithmetic is
// tested in daily.test.ts; this file tests the recorder half of spec §13: the charge is the keystroke
// gaps — capped at the pause line — never the idle span from the first key to the closing silence.
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionRecorder, type RecorderHost } from "../src/app/session.ts";
import { DEFAULT_SETTINGS } from "../src/data/store.ts";
import type { StatMap } from "../src/stats/stats.ts";

/** Computes session accuracy = (chars − errors) / chars × 100, rounded to 1 decimal. */
function accuracy(chars: number, errors: number): number | null {
	if (chars === 0) return null;
	return Math.round(((chars - errors) / chars) * 1000) / 10;
}

const T0 = 1_700_000_000_000;
const SEC = 1000;

/** Date.now answers, in call order: each keystroke's begin() reads it once, end() reads it once, and
 *  an elapsed() probe reads it once. Anything past the list returns to the real clock. */
const clock = (times: number[]) => {
	const real = Date.now;
	let i = 0;
	vi.spyOn(Date, "now").mockImplementation(() => (i < times.length ? times[i++] : real()));
};

function recorder(opts: { connected?: boolean } = {}) {
	const stats: StatMap = { a: { ttMs16: 2000, bestMs16: 2000, samples: 10, errors: 0 } };
	const charges: number[] = [];
	const delivered: { chars: number; ms: number }[] = [];
	const host: RecorderHost = {
		read: () => ({ key: "go60+qwerty", geometryId: "go60", keymapId: "qwerty", stats, settings: DEFAULT_SETTINGS, targetCpm: 200 }),
		writeStats: () => undefined,
		note: () => undefined,
		connected: () => opts.connected ?? false,
		recordDay: (ms) => charges.push(ms),
		deliver: async (session) => {
			delivered.push({ chars: session.chars, ms: session.ms });
			return { sent: session.chars };
		},
	};
	const typed = (n = 1) => {
		for (let k = 0; k < n; k += 1) {
			r.rec.begin();
			r.stats.a!.samples += 1;
		}
	};
	const r = { rec: new SessionRecorder(host), stats, charges, delivered, typed };
	return r;
}

describe("SessionRecorder day charges", () => {
	afterEach(() => vi.restoreAllMocks());

	it("charges the gaps between keys, not the silence after the last one", async () => {
		// Two keystrokes three seconds apart, then five minutes of reading the screen until end().
		// The record keeps the whole span; the day is charged the 3 s plus only the capped part of
		// the trailing silence — not five minutes of nothing.
		clock([T0, T0 + 3 * SEC, T0 + 300 * SEC]);
		const r = recorder({ connected: true });
		r.typed(2);
		await r.rec.end();
		expect(r.charges).toEqual([3 * SEC + 10 * SEC]);
		expect(r.delivered).toEqual([{ chars: 2, ms: 300 * SEC }]); // the repo row still spans the session
	});

	it("caps a long mid-session pause at the same line as the trailing one", async () => {
		clock([T0, T0 + 30 * SEC, T0 + 31 * SEC]);
		const r = recorder();
		r.typed(2); // the second key lands 30 s after the first: 10 s of it is practice, 20 s of it is a hunt
		await r.rec.end();
		expect(r.charges).toEqual([10 * SEC + 1 * SEC]);
	});

	it("freezes at the cap once typing stops", () => {
		// The live bar: it may grow for a cap's worth after the last key, then it must stop, or it
		// creeps while nobody types — the exact complaint this shape exists to answer.
		clock([T0, T0 + 2 * SEC, T0 + 600 * SEC]);
		const r = recorder();
		r.typed(2);
		expect(r.rec.elapsed()).toBe(2 * SEC + 10 * SEC);
	});

	it("is zero with no open session, before and after one", async () => {
		// The #startedAt guard in elapsed() is what stops the bar sitting on a phantom trailing gap
		// from a session that closed a minute ago.
		const r = recorder();
		expect(r.rec.elapsed()).toBe(0);
		clock([T0, T0 + SEC]);
		r.typed(2);
		await r.rec.end();
		expect(r.rec.elapsed()).toBe(0);
	});

	it("charges each of two sessions its own gaps, never the first one's again", async () => {
		// The reset lives in both begin() and end() on purpose; drop either and session two carries
		// session one's minutes on top. This is the test that notices.
		clock([T0, T0 + 2 * SEC, T0 + 3 * SEC, T0 + 4 * SEC, T0 + 9 * SEC, T0 + 14 * SEC]);
		const r = recorder();
		r.typed(2); // keys at +0 and +2 s, end at +3 s: 3 s of practice
		await r.rec.end();
		r.typed(2); // fresh span: keys 5 s apart, end 5 s later — 5 + 5
		await r.rec.end();
		expect(r.charges).toEqual([3 * SEC, 10 * SEC]);
	});

	it("charges once and never twice", async () => {
		clock([T0, T0 + SEC, T0 + 2 * SEC, T0 + 2 * SEC]);
		const r = recorder();
		r.typed(2);
		await r.rec.end();
		await r.rec.end(); // the idle timer and a pagehide can both fire for one session
		expect(r.charges.length).toBe(1);
	});

	it("charges on a device that delivers nothing", async () => {
		clock([T0, T0 + 5 * SEC, T0 + 5 * SEC]);
		const r = recorder({ connected: false });
		r.typed(2);
		await r.rec.end();
		expect(r.charges).toEqual([5 * SEC]);
		expect(r.delivered.length).toBe(0);
	});

	it("nothing charged when no stroke landed since the session opened", async () => {
		clock([T0, T0, T0 + SEC]);
		const r = recorder({ connected: true });
		r.rec.begin(); // opened by a keystroke the engine refused: the line was already finished
		await r.rec.end();
		expect(r.charges.length).toBe(0);
		expect(r.delivered.length).toBe(0);
	});
});

describe("SessionRecorder.sessionAccuracy", () => {
	it("is null when no session is open", () => {
		const r = recorder();
		expect(r.rec.sessionAccuracy()).toBeNull();
	});

	it("is null while the session is open but no characters have been typed", async () => {
		const r = recorder();
		r.stats.a!.samples = 10;
		r.stats.a!.errors = 2;
		r.rec.begin(); // captures baseline: 10 chars, 2 errors
		expect(r.rec.sessionAccuracy()).toBeNull(); // 0 chars delta
		await r.rec.end();
		expect(r.rec.sessionAccuracy()).toBeNull(); // no open session
	});

	it("returns the session percentage while the session is open", async () => {
		clock([T0, T0 + SEC, T0 + 2 * SEC]);
		const r = recorder();
		// Baseline: 10 chars, 2 errors.
		r.stats.a!.samples = 10;
		r.stats.a!.errors = 2;
		r.stats.a!.ttMs16 = 10 * 200;
		r.stats.a!.bestMs16 = 10 * 150;
		r.rec.begin(); // captures baseline
		// Now add 10 more chars, 2 of which are errors → delta: 10 chars, 2 errors → 80%
		r.stats.a!.samples = 20;
		r.stats.a!.errors = 4;
		expect(r.rec.sessionAccuracy()).toBe(80);
		await r.rec.end();
		expect(r.rec.sessionAccuracy()).toBeNull();
	});

	it("rounds to one decimal", async () => {
		clock([T0, T0 + SEC]);
		const r = recorder();
		// Baseline: 0 chars.
		r.stats.a!.samples = 0;
		r.stats.a!.errors = 0;
		r.rec.begin();
		// Add 7 chars, 1 error → 6/7 = 85.714… → rounds to 85.7
		r.stats.a!.samples = 7;
		r.stats.a!.errors = 1;
		expect(r.rec.sessionAccuracy()).toBe(85.7);
		await r.rec.end();
		expect(r.rec.sessionAccuracy()).toBeNull();
	});

	it("returns 100 for a perfect session", async () => {
		clock([T0, T0 + SEC]);
		const r = recorder();
		r.stats.a!.samples = 0;
		r.stats.a!.errors = 0;
		r.rec.begin();
		r.stats.a!.samples = 50;
		// errors stays 0
		expect(r.rec.sessionAccuracy()).toBe(100);
		await r.rec.end();
	});
});
