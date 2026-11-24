import { describe, expect, it } from "vitest";
import { buildDiagnostics } from "../src/app/diagnostics.ts";
import { emptyState } from "../src/atproto/sync.ts";
import type { Geometry, Keymap } from "../src/keyboard/types.ts";
import type { SessionRow } from "../src/atproto/records.ts";

const geometry = (id: string): Geometry => ({
	id,
	name: id,
	source: "test",
	verified: true,
	split: false,
	rowRoles: ["upper", "home", "lower"],
	keys: [
		{ id: "k1", hand: "l", row: 0, col: 0, x: 0, y: 0, w: 10, h: 10, rot: 0, label: "a" },
		{ id: "k2", hand: "r", row: 0, col: 1, x: 10, y: 0, w: 10, h: 10, rot: 0, label: "b" },
	],
});

const keymap = (id: string): Keymap => ({
	id,
	name: id,
	source: "test",
	rows: {
		upper: {
			l: ["q", "w", "", "", "", ""],
			r: ["p", "", "", "", "", ""],
		},
	},
});

const sessions: SessionRow[] = [
	{ rkey: "r1", layout: "go60+qwerty", atMs: 1735689600000, chars: 100, errors: 3, ms: 60000, stats: {} },
	{ rkey: "r2", layout: "go60+qwerty", atMs: 1735776000000, chars: 50, errors: 1, ms: 30000, stats: {} },
	{ rkey: "r3", layout: "corne+colemak", atMs: 0, chars: 20, errors: 0, ms: 10000, stats: {} },
];

describe("buildDiagnostics", () => {
	it("counts stats per layout key: letter rows, samples and errors", () => {
		const out = buildDiagnostics({
			stats: [
				{ key: "go60+qwerty", stats: { e: { ttMs16: 10, samples: 40, errors: 2 }, s: { ttMs16: 12, samples: 30, errors: 0 } } },
				{ key: "corne+colemak", stats: { a: { ttMs16: 8, samples: 5, errors: 1 } } },
			],
			settings: [],
			history: [],
			geometries: [],
			keymaps: [],
			sync: emptyState(),
			now: 1730000000000,
		});
		expect(out.stats).toEqual([
			{ key: "corne+colemak", rows: 1, totalSamples: 5, totalErrors: 1, lastUpdated: null },
			{ key: "go60+qwerty", rows: 2, totalSamples: 70, totalErrors: 2, lastUpdated: null },
		]);
	});

	it("reports settings keys with null last-updated, not an invented stamp", () => {
		const out = buildDiagnostics({
			stats: [],
			settings: [{ key: "go60+qwerty", settings: { geometry: "go60", keymap: "qwerty", targetCpm: 200, keyboardOrder: false, realWords: false } }],
			history: [],
			geometries: [],
			keymaps: [],
			sync: emptyState(),
			now: 1730000000000,
		});
		expect(out.settings).toEqual([{ key: "go60+qwerty", lastUpdated: null }]);
	});

	it("aggregates history per layout, with lastUpdated from the newest session", () => {
		const out = buildDiagnostics({
			stats: [],
			settings: [],
			history: sessions,
			geometries: [],
			keymaps: [],
			sync: emptyState(),
			now: 1730000000000,
		});
		expect(out.history).toEqual([
			{ key: "corne+colemak", sessions: 1, chars: 20, ms: 10000, lastUpdated: 0 },
			{ key: "go60+qwerty", sessions: 2, chars: 150, ms: 90000, lastUpdated: 1735776000000 },
		]);
	});

	it("lists layouts with key counts, boards then keymaps", () => {
		const out = buildDiagnostics({
			stats: [],
			settings: [],
			history: [],
			geometries: [geometry("go60")],
			keymaps: [keymap("qwerty")],
			sync: emptyState(),
			now: 1730000000000,
		});
		expect(out.layouts).toEqual([
			{ id: "go60", kind: "geometry", keys: 2 },
			{ id: "qwerty", kind: "keymap", keys: 3 },
		]);
	});

	it("carries sync stamps and outbox count, with progressSeen as row counts", () => {
		const out = buildDiagnostics({
			stats: [],
			settings: [],
			history: [],
			geometries: [],
			keymaps: [],
			sync: {
				progressRkeys: { "go60+qwerty": "r1" },
				layoutRkeys: {},
				outbox: [{ layout: "go60+qwerty", chars: 1, errors: 0, ms: 1000, stats: {} }],
				progressSeen: { "go60+qwerty": { e: { ttMs16: 1, samples: 2, errors: 0 }, s: { ttMs16: 1, samples: 2, errors: 0 } } },
				settingsLocalAt: 1730000001,
				lastPull: 1730000002,
			},
			now: 1730000000000,
		});
		expect(out.sync).toEqual({
			lastPull: 1730000002,
			settingsLocalAt: 1730000001,
			outbox: 1,
			progressSeen: { "go60+qwerty": 2 },
			progressRkeys: { "go60+qwerty": "r1" },
			layoutRkeys: {},
		});
		expect(out.generatedAt).toBe(1730000000000);
	});

	it("contains no letter text or layout name anywhere", () => {
		// Names go nowhere: the layout id is a key, the name is a string from a file. Give each fixture a
		// name that must not reach the clipboard.
		const namedGeometry = { ...geometry("go60-imported"), name: "IMPOSSIBLE-NAME-zzz" };
		const namedKeymap = { ...keymap("qwerty-imported"), name: "IMPOSSIBLE-NAME-zzz" };
		const out = buildDiagnostics({
			stats: [{ key: "go60+qwerty", stats: { e: { ttMs16: 1, samples: 1, errors: 0 } } }],
			settings: [],
			history: sessions,
			geometries: [namedGeometry],
			keymaps: [namedKeymap],
			sync: emptyState(),
			now: 1730000000000,
		});
		const json = JSON.stringify(out);
		expect(json).not.toContain('"e"');
		expect(json).not.toContain('"s"');
		expect(json).not.toContain("query");
		expect(json).not.toContain("IMPOSSIBLE-NAME-zzz");
		// The ids themselves are keys, and must appear.
		expect(json).toContain("go60-imported");
		expect(json).toContain("qwerty-imported");
	});
});

describe("copyDiagnostics", () => {
	it("copies the snapshot and reports the note", async () => {
		const { copyDiagnostics } = await import("../src/app/diagnostics.ts");
		let written = "";
		const note = await copyDiagnostics({
			load: async () => ({ stats: [], settings: [], history: [], sync: emptyState() }),
			layouts: () => ({ geometries: [], keymaps: [] }),
			write: async (text) => { written = text; },
			now: () => 1730000000000,
		});
		expect(note).toBe("diagnostics copied to the clipboard");
		expect(JSON.parse(written).generatedAt).toBe(1730000000000);
	});

	it("returns a failure note instead of throwing", async () => {
		const { copyDiagnostics } = await import("../src/app/diagnostics.ts");
		const note = await copyDiagnostics({
			load: async () => { throw new Error("db down"); },
			layouts: () => ({ geometries: [], keymaps: [] }),
			write: async () => undefined,
			now: () => 0,
		});
		expect(note).toBe("diagnostics failed: db down");
	});
});
