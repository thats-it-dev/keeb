// M4: the record layer, tested with no network and no storage. Everything the PDS will accept — or
// refuse — is decided here, so these are the tests that matter for sync.
import { describe, expect, it } from "vitest";
import { GO60 } from "../src/data/go60.ts";
import { keymapById } from "../src/data/keymaps.ts";
import { resolve } from "../src/keyboard/resolve.ts";
import { LAYOUT, PROGRESS, SETTINGS, SESSION, defs, layout, progress, session, settings } from "../src/atproto/lexicons.ts";
import { boardFromLayout, charMap, foldProgress, fromProgressRecord, fromSessionRecord, fromSettingsRecord, geometryFromRecord, keyGeometry, keyStats, layoutFromRecord, layoutRecord, mergeProgress, newKey, progressGrowth, progressRecord, pruneSessions, sessionRecord, sessionTimeMs, settingsRecord, statsFrom } from "../src/atproto/records.ts";
import type { StatMap } from "../src/stats/stats.ts";

const r = resolve(GO60, keymapById("qwerty"));

// A record's own shape: `bestMs16` is the field the curriculum reads, and a writer always sends it, so every
// expectation built from here carries it. What it carries is the mean, which is what a key with no memory of
// ever having been faster honestly claims.
const stat = (ttMs16: number, samples: number, errors = 0) => ({ ttMs16, bestMs16: ttMs16, samples, errors });

describe("records", () => {
	it("stores only integers, even when the source is fractional", () => {
		const g = { ...GO60, keys: GO60.keys.map((k, i) => ({ ...k, x: k.x + (i % 3) * 0.5, rot: i % 2 ? 12.34 : k.rot })) };
		for (const k of keyGeometry(g).keys) {
			expect(Number.isInteger(k.x)).toBe(true);
			expect(Number.isInteger(k.rot)).toBe(true);
			expect(Number.isInteger(k.w)).toBe(true);
		}
		// A NaN from a divide-by-zero somewhere upstream must not become null on the wire.
		expect(keyStats({ q: stat(NaN, undefined as unknown as number) })).toEqual([{ keyId: "q", ttMs16: 0, bestMs16: 0, samples: 0, errors: 0 }]);
	});

	it("keeps a geometry round-tripping, which is the part that broke in M1", () => {
		const back = geometryFromRecord(keyGeometry(GO60));
		expect(back.keys.length).toBe(GO60.keys.length);
		expect(back.split).toBe(!!GO60.split);
		for (const k of GO60.keys) {
			const mine = back.keys.find((x) => x.id === k.id)!;
			expect([mine.hand, mine.row, mine.col, mine.x, mine.y, mine.w, mine.h, mine.rot]).toEqual([k.hand, k.row, k.col, k.x, k.y, k.w, k.h, k.rot]);
		}
	});

	it("carries characters separately from positions", () => {
		const chars = charMap(r.keys.map((k) => ({ id: k.id, char: k.char })));
		expect(chars.chars.find((c) => c.keyId === "L_C5R3")?.char).toBe("a");
		expect(keyGeometry(GO60).keys[0]).not.toHaveProperty("char");
	});

	it("writes keyId and still reads the older id", () => {
		// The field was renamed before publishing because goat flags `id` as reserved across language
		// code generators, and a published field name is permanent. Records written under the old name are
		// still in repos, so reading accepts both and writing emits only the new one.
		expect(statsFrom([{ keyId: "a", ttMs16: 3200, samples: 10, errors: 1 }, { keyId: "s", ttMs16: 900, samples: 2, errors: 0 }])).toEqual({
			a: stat(3200, 10, 1),
			s: stat(900, 2),
		});
		expect(statsFrom([{ id: "a", ttMs16: 3200, samples: 10, errors: 1 } as never])).toEqual({ a: stat(3200, 10, 1) });
		// the new name wins when a row somehow carries both
		expect(Object.keys(statsFrom([{ keyId: "d", id: "f", ttMs16: 1, samples: 1, errors: 0 }]))).toEqual(["d"]);
		expect(geometryFromRecord({ split: false, keys: [{ id: "L_C5R3", hand: "l", row: 2, col: 5, x: 0, y: 0, w: 100, h: 100, rot: 0 } as never] }).keys[0]!.id).toBe("L_C5R3");
		expect(keyStats({ a: stat(1, 1) })[0]).not.toHaveProperty("id");
	});

	it("writes settings under the self key and reads back what it wrote", () => {
		const s = { geometry: "corne", keymap: "workman", targetCpm: 240, keyboardOrder: true, realWords: false };
		const rec = settingsRecord(s, 1_700_000_000_500);
		expect(rec.$type).toBe(SETTINGS);
		expect(rec.updatedAt).toBe(1_700_000_001);
		expect(fromSettingsRecord(rec as unknown as Record<string, unknown>)).toEqual(s);
	});

	it("ignores a record that is not a settings record", () => {
		expect(fromSettingsRecord({ $type: SESSION, geometry: "go60" })).toEqual({});
		expect(fromSettingsRecord(undefined)).toEqual({});
		// A half-written record still gives back the fields it has, so a newer device can add one.
		expect(fromSettingsRecord({ $type: SETTINGS, geometry: "lily58" })).toEqual({ geometry: "lily58" });
	});

	it("merges two devices by summing samples and weighting the means", () => {
		const local: StatMap = { a: stat(3200, 10, 1) }; // 200ms per key
		const remote: StatMap = { a: stat(4800, 30, 2), b: stat(1600, 4) };
		const m = mergeProgress(local, remote);
		expect(m.a).toEqual({ ttMs16: 4400, bestMs16: 3200, samples: 40, errors: 3 });
		expect(m.b).toEqual(stat(1600, 4));
		// 4400/16 = 275ms: the slow device's 30 samples dominate, which is the point of weighting.
		expect(Math.round(m.a!.ttMs16 / 16)).toBe(275);
	});

	it("finds nothing new in a record it has already folded in", () => {
		// The bug this pins: sync pushes this browser's numbers into a PROGRESS record, and the next pull
		// hands that same record back as if it were somebody else's evidence. Folding it in with mergeAll
		// added our own samples to our own samples, so every sync doubled the strokes and the typos.
		const mine = { a: stat(3200, 10, 2) };
		expect(progressGrowth(mine, mine)).toEqual({});
		expect(foldProgress(mine, mine, mine)).toEqual(mine);
	});

	it("folds in only the strokes the record gained since it was last seen", () => {
		// 10 samples accounted for at 200 ms, 20 now at 250 ms. The count of new strokes is arithmetic; their
		// mean is not recoverable from two EWMA snapshots, so the fold takes the record's current mean and
		// weights it by the ten strokes that are actually new.
		const seen = { a: stat(3200, 10, 2) };
		const remote = { a: stat(4000, 20, 3) };
		expect(progressGrowth(seen, remote)).toEqual({ a: stat(4000, 10, 1) });
		// Folded into a local copy of the record, the counts land where the repo says they are and the mean
		// lands between the two devices rather than on an invented number.
		const merged = foldProgress({ a: stat(3200, 10, 2) }, seen, remote);
		expect(merged.a!.samples).toBe(20);
		expect(merged.a!.errors).toBe(3);
		expect(Math.round(merged.a!.ttMs16 / 16)).toBe(225); // 200ms here, 250ms there, evenly weighted
	});

	it("takes a key the record has never shown before whole", () => {
		const growth = progressGrowth({ a: stat(3200, 10) }, { a: stat(3200, 10), q: stat(800, 3, 1) });
		expect(growth).toEqual({ q: stat(800, 3, 1) });
	});

	it("adds nothing for a record that came back smaller than the one already folded", () => {
		// A wipe on another device can leave a record holding fewer samples than the one already inside our
		// numbers. Subtracting would go negative, and "this record taught us nothing new" is the honest
		// reading of it — better than an invented mean or a negative count.
		expect(progressGrowth({ a: stat(3200, 40) }, { a: stat(2400, 12) })).toEqual({});
		expect(foldProgress({ a: stat(3200, 40) }, { a: stat(3200, 40) }, { a: stat(2400, 12) })).toEqual({ a: stat(3200, 40) });
	});

	it("orders stats by key id so the same progress always looks the same", () => {
		const ids = keyStats({ s: stat(1, 1), a: stat(1, 1), f: stat(1, 1) }).map((x) => x.keyId);
		expect(ids).toEqual(["a", "f", "s"]);
	});

	it("reads progress back into the shape the ladder wants", () => {
		const rec = progressRecord("go60+qwerty", { a: stat(3000, 12, 1) }, 1_700_000_000_000);
		expect(rec.$type).toBe(PROGRESS);
		expect(fromProgressRecord(rec as unknown as Record<string, unknown>)).toEqual({ layout: "go60+qwerty", stats: { a: stat(3000, 12, 1) } });
		expect(fromProgressRecord({ $type: SETTINGS, layout: "x" })).toBeUndefined();
	});

	it("summarises a session without storing a keystroke", () => {
		const rec = sessionRecord("corne+colemak_dh", { chars: 120, errors: 4, ms: 61_000.4, stats: { a: stat(2000, 10) } });
		expect(rec.$type).toBe(SESSION);
		expect(rec.ms).toBe(61000);
		expect(rec.errors).toBe(4);
	});

	it("prunes to the newest sessions per layout, using the tid as a clock", () => {
		const tids = Array.from({ length: 5 }, (_, i) => newKey() + String(i)).sort(); // distinct, time-ordered
		const rows = [...tids.map((rkey) => ({ rkey, layout: "go60+qwerty" })), { rkey: tids[0]!, layout: "corne+qwerty" }];
		const drop = pruneSessions(rows, 4);
		expect(drop).toEqual([tids[0]]); // oldest of the six go60 sessions; the corne one is untouched
		// A tid really is comparable as a string, or this test would be fiction.
		expect(tids[0]! < tids[4]!).toBe(true);
	});

	it("describes every record it writes", () => {
		expect([defs.id, settings.id, progress.id, session.id, layout.id]).toEqual([
			"app.thatsit.typing.defs",
			"app.thatsit.typing.settings",
			"app.thatsit.typing.progress",
			"app.thatsit.typing.session",
			"app.thatsit.typing.layout",
		]);
		expect(settings.defs.main.key).toBe("literal:self");
		expect([progress.defs.main.key, session.defs.main.key, layout.defs.main.key]).toEqual(["tid", "tid", "tid"]);
	});
});

describe("session rows", () => {
	it("reads the timestamp out of the rkey the record is filed under", () => {
		// There is no time field on a session record, so the tid is the only date the app has.
		const at = sessionTimeMs(newKey());
		expect(Math.abs(Date.now() - at)).toBeLessThan(2000);
	});

	it("decodes rkeys in the same order it sorts them, which pruneSessions relies on", () => {
		const a = newKey();
		const b = newKey();
		const ta = sessionTimeMs(a);
		const tb = sessionTimeMs(b);
		if (a < b) expect(tb).toBeGreaterThanOrEqual(ta);
		else expect(ta).toBeGreaterThanOrEqual(tb);
	});

	it("treats an unreadable rkey as undated rather than throwing", () => {
		// "self" is a real rkey in this app: the settings record uses a literal key. A tid that decodes to
		// an absurd date is handled the same way, because a session on 1970-01-01 would sit at the far end
		// of the chart and drag the day buckets with it.
		for (const k of ["self", "", "zzzzzzzzzzzzzzz", "2222222222222", "aaaaaaaaaaaaaaaaaaaa"]) expect(sessionTimeMs(k)).toBe(0);
	});

	it("parses a session row and coerces its numbers to integers", () => {
		const row = fromSessionRecord({ $type: SESSION, layout: "go60+qwerty", chars: 120.6, errors: 4, ms: 61_000.4, stats: [] }, newKey());
		expect(row?.chars).toBe(121);
		expect(row?.ms).toBe(61000);
		expect(row?.layout).toBe("go60+qwerty");
		expect(row?.atMs).toBeGreaterThan(0);
	});

	it("keeps the per-key snapshot, which is the only history the record has", () => {
		// This field used to be dropped on read. Everything in stats/insights.ts -- per-key trends, hesitation,
		// goal crossings -- is built from it, and the app looks identical without it except that four cards
		// quietly fall back to "not enough data". A round trip through the writer is the assertion that holds.
		const written = sessionRecord("go60+qwerty", { chars: 40, errors: 2, ms: 30_000, stats: { a: { ttMs16: 2400, bestMs16: 2400, samples: 12, errors: 2 } } });
		const row = fromSessionRecord(written as unknown as Record<string, unknown>, newKey());
		expect(row?.stats).toEqual({ a: { ttMs16: 2400, bestMs16: 2400, samples: 12, errors: 2 } });
	});

	it("reads an older record that carries no stats as an empty snapshot, not a crash", () => {
		// Sessions written before M7 have no stats array. The history screen must still chart them by totals.
		const row = fromSessionRecord({ $type: SESSION, layout: "go60+qwerty", chars: 10, errors: 0, ms: 5000 }, newKey());
		expect(row?.stats).toEqual({});
	});

	it("ignores records that are not sessions and tolerates sessions missing fields", () => {
		expect(fromSessionRecord({ $type: PROGRESS, layout: "x", stats: [], updatedAt: 1 }, newKey())).toBeUndefined();
		expect(fromSessionRecord(undefined, newKey())).toBeUndefined();
		const bare = fromSessionRecord({ $type: SESSION, layout: "go60+qwerty" }, "self");
		expect(bare).toEqual({ rkey: "self", layout: "go60+qwerty", atMs: 0, chars: 0, errors: 0, ms: 0, stats: {} });
	});

	it("carries a shared layout: positions, row roles and characters in one record", () => {
		const rec = layoutRecord("My Go60", "moergo manual", GO60, r.keys.map((k) => ({ id: k.id, char: k.char })));
		expect(rec.$type).toBe(LAYOUT);
		expect(rec.geometry.rowRoles).toEqual([...GO60.rowRoles]);
		const back = layoutFromRecord(rec as unknown as Record<string, unknown>)!;
		expect(back.name).toBe("My Go60");
		expect(back.source).toBe("moergo manual");
		expect(back.geometry.rowRoles).toEqual([...GO60.rowRoles]);
		// The characters have to land on the same physical keys they left from, or the receiving device
		// draws a board it cannot type on.
		const a = back.geometry.keys.find((k) => k.id === "L_C5R3")!;
		expect(back.byKey[a.id]).toBe("a");
		for (const k of back.geometry.keys) expect(Number.isInteger(k.x)).toBe(true);
	});

	it("drops a layout record that could not be a board", () => {
		expect(layoutFromRecord({ $type: LAYOUT, name: "x", geometry: { keys: [] }, charMap: { chars: [] } })).toBeUndefined();
		expect(layoutFromRecord({ $type: PROGRESS })).toBeUndefined();
		expect(layoutFromRecord(undefined)).toBeUndefined();
	});

	it("reads the row ladder from row indices when a record predates rowRoles", () => {
		const rec = { ...(keyGeometry(GO60) as Record<string, unknown>) };
		delete rec.rowRoles;
		const back = geometryFromRecord(rec as never);
		expect(back.rowRoles.length).toBeGreaterThan(2);
		expect(back.rowRoles).toContain("home");
	});


	it("gives a shared layout the same id on every device, because the id is the rkey", () => {
		const rec = layoutRecord("Go60", "keeb", GO60, r.keys.map((k) => ({ id: k.id, char: k.char })));
		const back = layoutFromRecord(rec as unknown as Record<string, unknown>)!;
		const { geometry, keymap } = boardFromLayout("2222sharedrkey", back);
		expect(geometry.id).toBe("shared:2222sharedrkey");
		expect(keymap.id).toBe(geometry.id); // one id for both halves, so layoutKey() stays readable
		expect(geometry.verified).toBe(false); // nobody has stood at this board
		expect(geometry.keys.length).toBe(GO60.keys.length);
		expect(Object.keys(keymap.byKey!).length).toBe(GO60.keys.length);
		// Registered twice (a pull on a device that already adopted it) must not be the thing that duplicates.
		expect(boardFromLayout("2222sharedrkey", back).geometry.id).toBe(geometry.id);
	});


	it("merges two devices without letting an untimed key vote on the speed", () => {
		// The second face of the run-boundary bug. A key struck only ever as someone's first keystroke
		// carries samples but no observation of time, and averaging it in as a 0 ms measurement rewrote the
		// other device's honest mean: 100 ms became 63.
		const timed = { a: { ttMs16: 1600, samples: 5, errors: 0 } }; // 100ms
		const untimed = { a: { ttMs16: 0, samples: 3, errors: 0 } }; // struck, never measured
		const m = mergeProgress(timed, untimed);
		expect(m.a!.ttMs16).toBe(1600); // the one device that measured anything carries the mean
		expect(m.a!.samples).toBe(8); // and every stroke still counts as a stroke
		// Two devices that both measured weight by exposure, as before.
		const both = mergeProgress({ b: { ttMs16: 1600, samples: 5, errors: 0 } }, { b: { ttMs16: 400, samples: 5, errors: 1 } });
		expect(both.b!.ttMs16).toBe(1000); // 100ms and 25ms average to 62.5ms
		expect(both.b!.samples).toBe(10);
	});

});
