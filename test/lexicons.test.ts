// The lexicons are the contract the PDS will judge us by. Checking them here, against the records the
// app actually writes, means a malformed schema fails a test today rather than in M5 when they go public.
import { describe, expect, it } from "vitest";
import { Lexicons, parseLexiconDoc } from "@atproto/lexicon";
import { LEXICONS, PROGRESS, SESSION, SETTINGS } from "../src/atproto/lexicons.ts";
import { charMap, geometryFromRecord, keyGeometry, progressRecord, sessionRecord, settingsRecord, statsFrom } from "../src/atproto/records.ts";
import { GO60 } from "../src/data/go60.ts";

const lex = new Lexicons();
for (const doc of LEXICONS) lex.add(parseLexiconDoc(doc));

// validate() answers with a single error carrying the field details, so a test failure reads as a list
// of reasons rather than one opaque string.
const check = (rec: Record<string, unknown>) => {
	const v = lex.validate(String(rec.$type), rec);
	if (v.success) return [];
	const detail = (v.error as Error & { detail?: { message?: string }[] }).detail;
	const reasons = (detail ?? []).map((e) => e?.message).filter(Boolean);
	return [reasons.join("; ") || v.error.message];
};

describe("lexicons", () => {
	it("are valid lexicon documents", () => {
		expect(LEXICONS.map((d) => d.id)).toEqual([
			"app.thatsit.typing.defs",
			SETTINGS,
			PROGRESS,
			SESSION,
			"app.thatsit.typing.layout",
		]);
	});

	it("accept the settings record the app writes", () => {
		const rec = settingsRecord({ geometry: "go60", keymap: "colemak_dh", targetCpm: 200, keyboardOrder: true, realWords: false }, Date.now());
		expect(check(rec as unknown as Record<string, unknown>)).toEqual([]);
		// Which letters are open is a verdict about this learner's numbers, not a preference, so it is not
		// something a record is allowed to carry.
		expect(rec).not.toHaveProperty("unlocked");
	});

	it("accept a progress record and read it back unchanged", () => {
		const stats = { a: { ttMs16: 3200, bestMs16: 3200, samples: 10, errors: 1 }, f: { ttMs16: 900, bestMs16: 600, samples: 3, errors: 0 } };
		const rec = progressRecord("go60+qwerty", stats, Date.now());
		expect(check(rec as unknown as Record<string, unknown>)).toEqual([]);
		expect(statsFrom(rec.stats)).toEqual(stats);
		// `bestMs16` is optional on the wire, so a record from a device that predates it still validates, and
		// reads back claiming the only figure it has: its own mean.
		const legacy = { a: { ttMs16: 3200, samples: 10, errors: 1 } };
		expect(check(progressRecord("go60+qwerty", legacy, Date.now()) as unknown as Record<string, unknown>)).toEqual([]);
		expect(statsFrom([{ keyId: "a", ttMs16: 3200, samples: 10, errors: 1 } as never])).toEqual({ a: { ttMs16: 3200, bestMs16: 3200, samples: 10, errors: 1 } });
	});

	it("accept a session record", () => {
		const rec = sessionRecord("corne+qwerty", { chars: 200, errors: 7, ms: 90_500, stats: { a: { ttMs16: 2400, samples: 40, errors: 7 } } });
		expect(check(rec as unknown as Record<string, unknown>)).toEqual([]);
	});

	it("accept a layout record, which is what sharing a board will look like", () => {
		const rec = {
			$type: "app.thatsit.typing.layout",
			name: "My Go60",
			source: "go60-info.json",
			geometry: keyGeometry(GO60),
			charMap: charMap([{ id: "L_C5R3", char: "a" }]),
		} as unknown as Record<string, unknown>;
		expect(check(rec)).toEqual([]);
		expect(geometryFromRecord(keyGeometry(GO60)).keys.length).toBe(GO60.keys.length);
	});

	it("refuse a float, which is the whole reason the numbers are scaled", () => {
		const rec = progressRecord("go60+qwerty", { a: { ttMs16: 3200.5, samples: 10, errors: 0 } }, Date.now()) as unknown as Record<string, unknown>;
		// records.ts rounds on the way out, so force the bad value in to prove the schema catches it
		(rec.stats as { ttMs16: number }[])[0]!.ttMs16 = 3200.5 as never;
		expect(check(rec).join(" ")).toMatch(/integer/i);
	});

	it("caps what a hostile client can post in one record", () => {
		// maxLength is the array cap; maxGraphemes on an array is ignored, so a wrong key here would
		// silently leave the record unbounded. 201 keys is more than any keyboard has.
		const keys = Array.from({ length: 201 }, (_, i) => ({ keyId: `k${i}`, hand: "l", row: 0, col: 0, x: i, y: 0, w: 100, h: 100, rot: 0 }));
		const rec = { $type: "app.thatsit.typing.layout", name: "flood", geometry: { keys }, charMap: { chars: [] } } as unknown as Record<string, unknown>;
		expect(check(rec).join(" ")).toMatch(/more than 200/i);
	});

	it("has no def for a type nobody declared", () => {
		expect(() => lex.validate("app.thatsit.typing.unknown", { x: 1 })).toThrow();
	});
});
