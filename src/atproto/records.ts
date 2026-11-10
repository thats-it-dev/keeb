// Conversions between what the app keeps in IndexedDB and what travels as a record.
//
// This module touches no network and no storage, so every rule here is unit-testable: the integer
// coercion, the additive merge, and which sessions get pruned. The client in sync.ts is thin because
// all the decisions live here.
import { TID } from "@atproto/common-web";
import { LAYOUT, PROGRESS, SETTINGS, SESSION } from "./lexicons.ts";
import { mergeAll, progressGrowth, type KeyStat, type StatMap } from "../stats/stats.ts";
import { ROW_ROLE_VALUES, type Geometry, type Key, type Keymap, type RowRole } from "../keyboard/types.ts";
import { rolesForRows } from "../layout/parse.ts";
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

/**
 * A tid for a moment in the past, for data that was not typed just now.
 *
 * Demo rows need this: their whole value is sitting at a believable date on a believable day, and a rkey
 * that is not a tid would make every one of them read as undated.
 */
export const tidAt = (ms: number): string => TID.fromTime(Math.round(ms) * 1000, 0).toString();

export type KeyChar = { id: string; char: string };

// On the wire the identifier is `keyId`. Reads also accept the old `id`: records written before the
// rename are still sitting in people's repos, and a schema that cannot read them would silently drop
// every key they had practised. Writes only ever emit `keyId`.
export type WireKeyId = { keyId?: string; id?: string };
const wireKeyId = (s: WireKeyId): string => str(s.keyId ?? s.id);

export type KeyGeometryRecord = { split: boolean; rowRoles?: string[]; keys: ({ keyId: string } & WireKeyId & { hand: string; row: number; col: number; x: number; y: number; w: number; h: number; rot: number; label: string })[] };

// The geometry half of a layout: where the keys are, and what each physical row is for. No characters
// travel here, so one geometry can be paired with any keymap on the receiving device too.
export function keyGeometry(g: Geometry): KeyGeometryRecord {
	return {
		split: !!g.split,
		rowRoles: (g.rowRoles ?? []).map((r) => str(r, 20)),
		keys: g.keys.map((k: Key) => ({ keyId: k.id, hand: k.hand, row: n(k.row), col: n(k.col), x: n(k.x), y: n(k.y), w: n(k.w), h: n(k.h), rot: n(k.rot), label: str(k.label, 20) })),
	};
}

export function geometryFromRecord(rec: KeyGeometryRecord): Pick<Geometry, "split" | "rowRoles" | "keys"> {
	const keys = (rec?.keys ?? []).map((k) => ({
		id: wireKeyId(k),
		hand: k.hand === "r" ? "r" : "l",
		row: n(k.row),
		col: n(k.col),
		x: n(k.x),
		y: n(k.y),
		w: n(k.w) || 100,
		h: n(k.h) || 100,
		rot: n(k.rot),
		label: str(k.label, 20),
	})) as Key[];
	// A record written before rowRoles existed still has to say which row is the home row, so the same
	// ladder parse.ts applies to an imported file fills in from the row indices. One table, not two.
	const given: RowRole[] = Array.isArray(rec?.rowRoles) ? rec.rowRoles.map((r) => ((ROW_ROLE_VALUES as string[]).includes(String(r)) ? (String(r) as RowRole) : "extra")) : [];
	const rows = [...new Set(keys.map((k) => k.row))].sort((a, b) => a - b);
	return {
		split: !!rec?.split,
		rowRoles: given.length ? given : rolesForRows(rows),
		keys,
	};
}

export const charMap = (keys: KeyChar[]) => ({ chars: keys.map((k) => ({ keyId: str(k.id), char: [...k.char].slice(0, 4).join("") })) });

export type LayoutRecord = { $type: string; name: string; source: string; geometry: KeyGeometryRecord; charMap: { chars: { keyId: string; char: string }[] } };

/**
 * The board on screen as one record: where the keys are, what each row is for, and what each key produces.
 * Characters are resolved from geometry x keymap rather than copied from a keymap, which is what lets an
 * imported board and a shipped one share a format.
 */
export function layoutRecord(name: string, source: string, g: Geometry, chars: KeyChar[]): LayoutRecord {
	return { $type: LAYOUT, name: str(name), source: str(source, 300), geometry: keyGeometry(g), charMap: charMap(chars) };
}

// The id a shared layout carries on every device: the record's rkey, which is the one thing two browsers
// cannot disagree about. Built-in ids are never prefixed, so nothing can collide with a shipped board.
export const SHARED_PREFIX = "shared:";

/**
 * The board and the keymap a shared layout record implies, with the ids every device will use. Characters
 * ride per key rather than per row position: an imported board has letters on keys the 3x6 grid has no slot
 * for, and a keymap built from rows alone would quietly drop them.
 */
export function boardFromLayout(rkey: string, s: SharedLayout): { geometry: Geometry; keymap: Keymap } {
	const id = SHARED_PREFIX + rkey;
	const name = s.name || "Shared layout";
	const source = s.source || "a shared atproto record";
	return {
		geometry: { id, name, source, verified: false, split: s.geometry.split, rowRoles: s.geometry.rowRoles, keys: s.geometry.keys },
		keymap: { id, name, source, rows: {}, byKey: s.byKey },
	};
}

export type SharedLayout = { name: string; source: string; geometry: Pick<Geometry, "split" | "rowRoles" | "keys">; byKey: Record<string, string> };

/** A layout record, or nothing usable. A record with no keys is not a board, so it is dropped rather than
 *  registered as an empty one. */
export function layoutFromRecord(rec: Record<string, unknown> | undefined): SharedLayout | undefined {
	if (!rec || rec.$type !== LAYOUT) return undefined;
	const geo = geometryFromRecord(rec.geometry as KeyGeometryRecord);
	if (!geo.keys.length) return undefined;
	const byKey: Record<string, string> = {};
	for (const c of (rec.charMap as { chars?: ({ char?: unknown } & WireKeyId)[] } | undefined)?.chars ?? []) {
		const id = wireKeyId(c ?? {});
		const ch = typeof c?.char === "string" ? c.char : "";
		if (id && ch) byKey[id] = ch;
	}
	return { name: str(rec.name), source: str(rec.source, 300), geometry: geo, byKey };
}

// The wire form of a StatMap. Sorted by key id so two devices that never met still produce byte-equal
// arrays for the same progress, which makes a diff during debugging mean something.
export const keyStats = (stats: StatMap) =>
	Object.entries(stats)
		.sort((a, b) => (a[0] < b[0] ? -1 : 1))
		.map(([id, s]) => ({ keyId: str(id), ttMs16: n(s.ttMs16), samples: n(s.samples), errors: n(s.errors) }));

export function statsFrom(list: ({ ttMs16: number; samples: number; errors: number } & WireKeyId)[]): StatMap {
	const out: StatMap = {};
	for (const s of list ?? []) {
		const id = wireKeyId(s ?? { ttMs16: 0, samples: 0, errors: 0 });
		if (!id) continue;
		out[id] = { ttMs16: n(s.ttMs16), samples: n(s.samples), errors: n(s.errors) };
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
 * A session as the app wants it. `atMs` is when it happened, which the record itself does not say.
 *
 * `stats` is the per-key state as it stood when the session ended -- a CUMULATIVE snapshot, not that
 * session's own numbers. `chars`, `errors` and `ms` beside it are per-session deltas. The two halves of
 * one record are different kinds of thing, and any code that diffs them has to know which side it is on.
 */
export type SessionRow = {
	rkey: string;
	layout: string;
	atMs: number;
	chars: number;
	errors: number;
	ms: number;
	stats: StatMap;
};

/**
 * When a session was typed, in ms since the epoch. There is no time field on the record: the lexicon is
 * published and has none, so the tid in the rkey is the timestamp, which is what `pruneSessions` already
 * relies on. Note `TID.timestamp()` is MICROSECONDS, and a tid that does not parse just yields a
 * nonsense number rather than throwing -- so it is range-checked and treated as unknown when absurd.
 * An unknown session still counts in the totals; it only cannot be placed on a day.
 */
export function sessionTimeMs(rkey: string): number {
	let micros: number;
	try {
		micros = new TID(rkey).timestamp();
	} catch {
		return 0;
	}
	if (!Number.isFinite(micros) || micros <= 0) return 0;
	const ms = Math.round(micros / 1000);
	// 2020-01-01 to one day from now. A real session is inside that; a garbage tid is not.
	return ms >= 1577836800000 && ms <= Date.now() + 86_400_000 ? ms : 0;
}

/** One session record from the network, or nothing usable. */
export function fromSessionRecord(rec: Record<string, unknown> | undefined, rkey: string): SessionRow | undefined {
	if (!rec || rec.$type !== SESSION || typeof rec.layout !== "string") return undefined;
	return {
		rkey,
		layout: rec.layout,
		atMs: sessionTimeMs(rkey),
		chars: n(rec.chars),
		errors: n(rec.errors),
		// `ms` is the field name on the wire and means the session's wall-clock span. Renamed on the way in
		// because every other ms in this app is a per-key timing, and a collision there is how charts lie.
		ms: n(rec.ms),
		// The per-key history every chart is drawn from. Without it a session is three integers, and the
		// history screen has nothing to break down.
		stats: Array.isArray(rec.stats) ? statsFrom(rec.stats as KeyStat[]) : {},
	};
}

/**
 * Local and remote progress, combined. `mergeAll` adds the sample counts and weights each mean by its
 * own count, which is why two devices can drift apart for a week and still merge without a conflict.
 */
export const mergeProgress = (local: StatMap, remote: StatMap): StatMap => mergeAll(local, remote);

/**
 * What a progress record has learned since the last time this device accounted for it. `seen` is the
 * content of that same record on the previous sync, or nothing the first time. The math lives in
 * `progressGrowth` in stats.ts, beside the merge it inverts.
 *
 * This exists because a PROGRESS record is a shared accumulator: the numbers this browser pushed are
 * sitting in it, and pulling the record back and folding it in with `mergeProgress` added our own strokes
 * to our own strokes. Every sync doubled the sample and error counts.
 */
export { progressGrowth } from "../stats/stats.ts";

/** Fold a record's growth into local progress. `seen` empty means this device has never accounted for the
 *  record, which is the same thing as it being somebody else's new evidence. */
export const foldProgress = (local: StatMap, seen: StatMap | undefined, remote: StatMap | undefined): StatMap =>
	remote ? mergeAll(local, progressGrowth(seen ?? {}, remote)) : { ...local };

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
