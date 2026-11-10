// Who gets charged when a practice session closes, and how often. The tally arithmetic is tested in
// daily.test.ts; this file tests the recorder half of spec §13: the charge fires at end(), once, and
// whether or not a repo receives the session.
import { describe, expect, it, vi } from "vitest";
import { SessionRecorder, type RecorderHost } from "../src/app/session.ts";
import { DEFAULT_SETTINGS } from "../src/data/store.ts";
import type { StatMap } from "../src/stats/stats.ts";

const T0 = 1_700_000_000_000;
const MIN = 60_000;

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
	return { rec: new SessionRecorder(host), stats, charges, delivered };
}

describe("SessionRecorder day charges", () => {
	it("charges the wall-clock span at end, and does not charge twice", async () => {
		vi.spyOn(Date, "now").mockReturnValueOnce(T0).mockReturnValueOnce(T0 + 2 * MIN);
		const r = recorder();
		r.rec.begin();
		r.stats.a!.samples += 5;
		await r.rec.end();
		await r.rec.end(); // the idle timer and a pagehide can both fire for one session
		expect(r.charges).toEqual([2 * MIN]);
		vi.restoreAllMocks();
	});

	it("charges on a device that delivers nothing", async () => {
		vi.spyOn(Date, "now").mockReturnValueOnce(T0).mockReturnValueOnce(T0 + MIN);
		const r = recorder({ connected: false });
		r.rec.begin();
		r.stats.a!.samples += 3;
		await r.rec.end();
		expect(r.charges.length).toBe(1);
		expect(r.delivered.length).toBe(0);
		vi.restoreAllMocks();
	});

	it("charges and delivers together when there is a repo", async () => {
		vi.spyOn(Date, "now").mockReturnValueOnce(T0).mockReturnValueOnce(T0 + MIN);
		const r = recorder({ connected: true });
		r.rec.begin();
		r.stats.a!.samples += 3;
		await r.rec.end();
		expect(r.charges).toEqual([MIN]);
		expect(r.delivered).toEqual([{ chars: 3, ms: MIN }]);
		vi.restoreAllMocks();
	});

	it("nothing charged when no stroke landed since the session opened", async () => {
		vi.spyOn(Date, "now").mockReturnValueOnce(T0).mockReturnValueOnce(T0 + MIN);
		const r = recorder({ connected: true });
		r.rec.begin();
		await r.rec.end(); // opened and closed on the same stats: a walk-away, not a practice span
		expect(r.charges.length).toBe(0);
		expect(r.delivered.length).toBe(0);
		vi.restoreAllMocks();
	});
});
