// Conversions between what the app keeps in IndexedDB and what travels as a record.
//
// This module touches no network and no storage, so every rule here is unit-testable: the integer
// coercion, the additive merge, and which sessions get pruned. The client in sync.ts is thin because
// all the decisions live here.
import { TID } from "@atproto/common-web";
import { PROGRESS, SETTINGS, SESSION } from "./lexicons.ts";
import { mergeAll, type KeyStat, type StatMap } from "../stats/stats.ts";
import type { Geometry, Key } from "../keyboard/types.ts";
import type { Settings } from "../data/store.ts";

/** Seconds since the epoch, as the records store it. */
export const clockSeconds = (ms: number): number => Math.round(ms / 1000);

// Rounding here is not cosmetic: a float in a record is rejected by the PDS, and the app has several
// places where a mean or a scaled coordinate is naturally fractional.
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);

const str = (v: unknown, max = 100): string => (typeof v === "string" ? [...v].slice(0, max).join("") : "");

// A fresh rkey. TIDs sort lexicographically by creation time, which is what makes the session prune
// below a string comparison rather than a timestamp lookup.
export const newKey = (): string => TID.nextStr();

export type KeyChar = { id: string; char: string };

export type KeyGeometryRecord = { split: boolean; keys: { id: string; hand: string; row: number; col: number; x: number; y: number; w: number; h: number; rot: number; label: string }[] };

// The geometry half of a layout: where the keys are. Nothing about characters travels in it, so one
// geometry can be paired with any keymap on the receiving device too.
export function keyGeometry(g: Geometry): KeyGeometryRecord {
	return {
		split: !!g.split,
		keys: g.keys.map((k: Key) => ({ id: k.id, hand: k.hand, row: n(k.row), col: n(k.col), x: n(k.x), y: n(k.y), w: n(k.w), h: n(k.h), rot: n(k.rot), label: str(k.label, 20) })),
	};
}

export function geometryFromRecord(rec: KeyGeometryRecord): Pick<Geometry, "split" | "keys"> {
	return {
		split: !!rec?.split,
		keys: (rec?.keys ?? []).map((k) => ({
			id: str(k.id),
			hand: k.hand === "r" ? "r" : "l",
			row: n(k.row),
			col: n(k.col),
			x: n(k.x),
			y: n(k.y),
			w: n(k.w) || 100,
			h: n(k.h) || 100,
			rot: n(k.rot),
			label: str(k.label, 20),
		})) as Key[],
	};
}

export const charMap = (keys: KeyChar[]) => ({ chars: keys.map((k) => ({ id: str(k.id), char: [...k.char].slice(0, 4).join("") })) });

// The wire form of a StatMap. Sorted by key id so two devices that never met still produce byte-equal
// arrays for the same progress, which makes a diff during debugging mean something.
export const keyStats = (stats: StatMap) =>
	Object.entries(stats)
		.sort((a, b) => (a[0] < b[0] ? -1 : 1))
		.map(([id, s]) => ({ id: str(id), ttMs16: n(s.ttMs16), samples: n(s.samples), errors: n(s.errors) }));

export function statsFrom(list: { id: string; ttMs16: number; samples: number; errors: number }[]): StatMap {
	const out: StatMap = {};
	for (const s of list ?? []) {
		if (!s?.id) continue;
		out[str(s.id)] = { ttMs16: n(s.ttMs16), samples: n(s.samples), errors: n(s.errors) };
	}
	return out;
}

export type SettingsRecord = { $type: string; geometry: string; keymap: string; targetCpm: number; updatedAt: number; unlocked: string[] };

export function settingsRecord(s: Settings, nowMs: number): SettingsRecord {
	return {
		$type: SETTINGS,
		geometry: str(s.geometry),
		keymap: str(s.keymap),
		targetCpm: n(s.targetCpm),
		updatedAt: clockSeconds(nowMs),
		unlocked: (s.unlocked ?? []).map((id) => str(id)),
	};
}

/** A record from the network, or nothing usable. Unknown shapes yield {} so the caller keeps local values. */
export function fromSettingsRecord(rec: Record<string, unknown> | undefined): Partial<Settings> {
	if (!rec || rec.$type !== SETTINGS) return {};
	const out: Partial<Settings> = {};
	if (typeof rec.geometry === "string") out.geometry = rec.geometry;
	if (typeof rec.keymap === "string") out.keymap = rec.keymap;
	if (typeof rec.targetCpm === "number") out.targetCpm = n(rec.targetCpm);
	if (Array.isArray(rec.unlocked)) out.unlocked = rec.unlocked.filter((x): x is string => typeof x === "string");
	return out;
}

export type ProgressRecord = { $type: string; layout: string; stats: ReturnType<typeof keyStats>; updatedAt: number };

export const progressRecord = (layout: string, stats: StatMap, nowMs: number): ProgressRecord => ({
	$type: PROGRESS,
	layout: str(layout),
	stats: keyStats(stats),
	updatedAt: clockSeconds(nowMs),
});

export type SessionRecord = { $type: string; layout: string; chars: number; errors: number; ms: number; stats: ReturnType<typeof keyStats> };

/** One finished practice session. Keystrokes themselves are never stored. */
export const sessionRecord = (layout: string, s: { chars: number; errors: number; ms: number; stats: StatMap }): SessionRecord => ({
	$type: SESSION,
	layout: str(layout),
	chars: n(s.chars),
	errors: n(s.errors),
	ms: n(s.ms),
	stats: keyStats(s.stats),
});

export function fromProgressRecord(rec: Record<string, unknown> | undefined): { layout: string; stats: StatMap } | undefined {
	if (!rec || rec.$type !== PROGRESS || typeof rec.layout !== "string") return undefined;
	const stats = Array.isArray(rec.stats) ? statsFrom(rec.stats as ProgressRecord["stats"]) : {};
	return { layout: rec.layout, stats };
}

/**
 * Local and remote progress, combined. `mergeAll` adds the sample counts and weights each mean by its
 * own count, which is why two devices can drift apart for a week and still merge without a conflict.
 */
export const mergeProgress = (local: StatMap, remote: StatMap): StatMap => mergeAll(local, remote);

/**
 * The rkeys to delete so no layout keeps more than `cap` sessions: the oldest per layout, decided by the
 * tid itself. Sessions are pruned per layout because a learner who switches boards should not lose the
 * history of the one they are on.
 */
export function pruneSessions(rows: { rkey: string; layout: string }[], cap = 50): string[] {
	const byLayout = new Map<string, string[]>();
	for (const r of rows) byLayout.set(r.layout, [...(byLayout.get(r.layout) ?? []), r.rkey]);
	const drop: string[] = [];
	for (const tids of byLayout.values()) {
		const sorted = [...tids].sort(); // tids are time-ordered as strings
		if (sorted.length > cap) drop.push(...sorted.slice(0, sorted.length - cap));
	}
	return drop;
}

export type { KeyStat };
