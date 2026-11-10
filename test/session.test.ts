// Who gets charged when a practice session closes, how often, and how much. The tally arithmetic is
// tested in daily.test.ts; this file tests the recorder half of spec §13: the charge is the keystroke
// gaps — capped at the pause line — never the idle span from the first key to the closing silence.
import { describe, expect, it, vi } from "vitest";
import { SessionRecorder, type RecorderHost } from "../src/app/session.ts";
import { DEFAULT_SETTINGS } from "../src/data/store.ts";
import type { StatMap } from "../src/stats/stats.ts";

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
		vi.restoreAllMocks();
	});

	it("caps a long mid-session pause at the same line as the trailing one", async () => {
		clock([T0, T0 + 30 * SEC, T0 + 31 * SEC]);
		const r = recorder();
		r.typed(2); // the second key lands 30 s after the first: 10 s of it is practice, 20 s of it is a hunt
		await r.rec.end();
		expect(r.charges).toEqual([10 * SEC + 1 * SEC]);
		vi.restoreAllMocks();
	});

	it("freezes at the cap once typing stops", () => {
		// The live bar: it may grow for a cap's worth after the last key, then it must stop, or it
		// creeps while nobody types — the exact complaint this shape exists to answer.
		clock([T0, T0 + 2 * SEC, T0 + 600 * SEC]);
		const r = recorder();
		r.typed(2);
		expect(r.rec.elapsed()).toBe(2 * SEC + 10 * SEC);
		vi.restoreAllMocks();
	});

	it("charges once and never twice", async () => {
		clock([T0, T0 + SEC, T0 + 2 * SEC, T0 + 2 * SEC]);
		const r = recorder();
		r.typed(2);
		await r.rec.end();
		await r.rec.end(); // the idle timer and a pagehide can both fire for one session
		expect(r.charges.length).toBe(1);
		vi.restoreAllMocks();
	});

	it("charges on a device that delivers nothing", async () => {
		clock([T0, T0 + 5 * SEC, T0 + 5 * SEC]);
		const r = recorder({ connected: false });
		r.typed(2);
		await r.rec.end();
		expect(r.charges).toEqual([5 * SEC]);
		expect(r.delivered.length).toBe(0);
		vi.restoreAllMocks();
	});

	it("nothing charged when no stroke landed since the session opened", async () => {
		clock([T0, T0, T0 + SEC]);
		const r = recorder({ connected: true });
		r.rec.begin(); // opened by a keystroke the engine refused: the line was already finished
		await r.rec.end();
		expect(r.charges.length).toBe(0);
		expect(r.delivered.length).toBe(0);
		vi.restoreAllMocks();
	});
});
