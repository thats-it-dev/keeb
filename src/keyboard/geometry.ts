import type { Finger, Geometry, Key, RowRole } from "./types.ts";

export const U = 100; // one key unit, in hundredths

// [id, hand, row, col, x, y, label, rot?, w?, h?] — x/y in 1/100 key units, rot in 1/10 degrees.
export type KeyTuple = [string, "l" | "r", number, number, number, number, string, number?, number?, number?];

export function key(t: KeyTuple): Key {
	return { id: t[0], hand: t[1], row: t[2], col: t[3], x: t[4], y: t[5], label: t[6], rot: t[7] ?? 0, w: t[8] ?? U, h: t[9] ?? U };
}

export type GeometryOpts = Omit<Geometry, "keys"> & { keys: KeyTuple[] };

export function geometry(opts: GeometryOpts): Geometry {
	return { ...opts, keys: opts.keys.map(key) };
}

export function roleOf(g: Geometry, row: number): RowRole {
	return g.rowRoles[row] ?? "extra";
}

// One table for both hands: col 0 is the outer edge, so cols 0-1 serve the pinky, 4-5 the index.
const FINGER_BY_COL = ["p", "p", "r", "m", "i", "i"] as const;

export function fingerOf(g: Geometry, k: Key): Finger {
	if (roleOf(g, k.row) === "thumb") return k.hand === "l" ? "lt" : "rt";
	// Negative columns are keys beyond the outer edge (ANSI's ] \ Enter); they are pinky reach.
	return `${k.hand}${FINGER_BY_COL[Math.max(0, Math.min(5, k.col))]}` as Finger;
}

export function bounds(keys: Key[]): { width: number; height: number } {
	let width = 0;
	let height = 0;
	for (const k of keys) {
		width = Math.max(width, k.x + k.w);
		height = Math.max(height, k.y + k.h);
	}
	return { width, height };
}

// What a geometry claims about itself, as human-readable problems. Empty means it is usable.
export function geometryProblems(g: Geometry): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const k of g.keys) {
		if (seen.has(k.id)) out.push(`duplicate key id ${k.id}`);
		seen.add(k.id);
		for (const [field, value] of [["x", k.x], ["y", k.y], ["w", k.w], ["h", k.h], ["rot", k.rot]] as const) {
			if (!Number.isInteger(value)) out.push(`${k.id}: ${field} must be an integer, got ${value}`);
		}
		if (k.col < -4 || k.col > 6) out.push(`${k.id}: column ${k.col} outside -4..6`);
		if (roleOf(g, k.row) === "extra" && /^[A-Za-z]$/.test(k.label)) out.push(`${k.id}: letter "${k.label}" sits on an untaught row ${k.row}`);
	}
	const hands = new Set(g.keys.map((k) => k.hand));
	if (g.keys.length === 0) out.push("no keys");
	if (hands.size === 1) out.push("every key is on one hand");
	return [...new Set(out)];
}
