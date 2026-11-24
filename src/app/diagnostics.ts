// A pasteable snapshot of what this browser holds. No typed text: every entry is a key, a count or a
// stamp, so a learner can paste it somewhere and it cannot leak what they typed.
import type { SyncState } from "../atproto/sync.ts";
import type { SessionRow } from "../atproto/records.ts";
import type { Geometry, Keymap } from "../keyboard/types.ts";
import type { Settings } from "../data/store.ts";
import type { StatMap } from "../stats/stats.ts";

export type Diagnostics = {
	generatedAt: number;
	stats: { key: string; rows: number; totalSamples: number; totalErrors: number; lastUpdated: null }[];
	settings: { key: string; lastUpdated: null }[];
	history: { key: string; sessions: number; chars: number; ms: number; lastUpdated: number }[];
	layouts: { id: string; kind: "geometry" | "keymap"; keys: number }[];
	sync: { lastPull: number; settingsLocalAt: number; outbox: number; progressSeen: Record<string, number>; progressRkeys: Record<string, string>; layoutRkeys: Record<string, string> };
};

function statsSummary(key: string, stats: StatMap): Diagnostics["stats"][number] {
	let rows = 0;
	let totalSamples = 0;
	let totalErrors = 0;
	for (const s of Object.values(stats)) {
		rows += 1;
		totalSamples += s.samples;
		totalErrors += s.errors;
	}
	// A stats row carries no timestamp today, so the answer is honestly null rather than invented.
	return { key, rows, totalSamples, totalErrors, lastUpdated: null };
}

function historySummary(key: string, sessions: SessionRow[]): Diagnostics["history"][number] {
	let sessionsN = 0;
	let chars = 0;
	let ms = 0;
	let lastUpdated = 0;
	for (const s of sessions) {
		if (s.layout !== key) continue;
		sessionsN += 1;
		chars += s.chars;
		ms += s.ms;
		if (s.atMs > lastUpdated) lastUpdated = s.atMs;
	}
	return { key, sessions: sessionsN, chars, ms, lastUpdated };
}

function geometryKeys(g: Geometry): number {
	return g.keys.length;
}

function keymapKeys(k: Keymap): number {
	let n = 0;
	for (const row of Object.values(k.rows)) {
		for (const half of [row.l, row.r]) for (const ch of half) if (ch) n += 1;
	}
	if (k.byKey) n += Object.keys(k.byKey).length;
	for (const layer of k.layers ?? []) n += Object.keys(layer.byKeyId).length;
	return n;
}

/**
 * The whole snapshot. `now` is passed in so the test can pin the stamp and nothing reads the clock.
 * Shape is deliberately flat and small: keys are the layout pairs the store writes, counts are sums,
 * and nothing in here is a typed character.
 */
export function buildDiagnostics(input: {
	stats: { key: string; stats: StatMap }[];
	settings: { key: string; settings: Settings }[];
	history: SessionRow[];
	geometries: Geometry[];
	keymaps: Keymap[];
	sync: SyncState;
	now: number;
}): Diagnostics {
	const histKeys = [...new Set(input.history.map((s) => s.layout))].sort((a, b) => a.localeCompare(b));
	return {
		generatedAt: input.now,
		stats: [...input.stats].sort((a, b) => a.key.localeCompare(b.key)).map(({ key, stats }) => statsSummary(key, stats)),
		settings: [...input.settings].sort((a, b) => a.key.localeCompare(b.key)).map(({ key }) => ({ key, lastUpdated: null })),
		history: histKeys.map((key) => historySummary(key, input.history)),
		layouts: [
			...input.geometries.map((g) => ({ id: g.id, kind: "geometry" as const, keys: geometryKeys(g) })),
			...input.keymaps.map((k) => ({ id: k.id, kind: "keymap" as const, keys: keymapKeys(k) })),
		],
		sync: {
			lastPull: input.sync.lastPull,
			settingsLocalAt: input.sync.settingsLocalAt ?? 0,
			outbox: input.sync.outbox.length,
			progressSeen: Object.fromEntries(Object.entries(input.sync.progressSeen ?? {}).map(([key, stats]) => [key, Object.keys(stats).length])),
			progressRkeys: input.sync.progressRkeys,
			layoutRkeys: input.sync.layoutRkeys,
		},
	};
}

import { loadHistory, loadSettingsAll, loadStatsAll, loadSyncState } from "../data/store.ts";
import { allGeometries } from "../data/geometries.ts";
import { allKeymaps } from "../data/keymaps.ts";

/** The side-effecting half, kept here so the builders above stay pure and the page only wires.
 *  Deps are injectable for the same reason the orphan fold is. Returns the line the page should show. */
export type CopyDeps = {
	load(): Promise<{ stats: { key: string; stats: StatMap }[]; settings: { key: string; settings: Settings }[]; history: SessionRow[]; sync: SyncState }>;
	layouts(): { geometries: Geometry[]; keymaps: Keymap[] };
	write(text: string): Promise<void>;
	now(): number;
};

const defaultDeps: CopyDeps = {
	load: async () => {
		const [stats, settings, history, sync] = await Promise.all([loadStatsAll(), loadSettingsAll(), loadHistory(), loadSyncState()]);
		return { stats, settings, history, sync };
	},
	layouts: () => ({ geometries: allGeometries(), keymaps: allKeymaps() }),
	write: (text) => navigator.clipboard.writeText(text),
	now: () => Date.now(),
};

/** Copy the snapshot to the clipboard; return the one line the learner should be told. Never throws. */
export async function copyDiagnostics(deps: CopyDeps = defaultDeps): Promise<string> {
	try {
		const { stats, settings, history, sync } = await deps.load();
		const { geometries, keymaps } = deps.layouts();
		const text = JSON.stringify(buildDiagnostics({ stats, settings, history, geometries, keymaps, sync, now: deps.now() }), null, 2);
		await deps.write(text);
		return "diagnostics copied to the clipboard";
	} catch (err) {
		return `diagnostics failed: ${(err as Error).message}`;
	}
}
