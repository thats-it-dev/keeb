import { bounds, fingerOf, geometryProblems, roleOf } from "../keyboard/geometry.ts";
import type { Geometry, Key, Keymap, RenderKey } from "../keyboard/types.ts";

export type Resolved = {
	geometry: Geometry;
	keys: RenderKey[];
	byId: Map<string, RenderKey>;
	// Lowercased typed character -> key id. Only single-character labels are indexable.
	byChar: Map<string, string>;
	viewBox: { x: number; y: number; width: number; height: number };
	problems: string[];
};

const ALPHA = ["upper", "home", "lower"] as const;

// A key the keymap claims: one of the three touch-typing rows, and not the outer column.
export function isTaught(g: Geometry, k: Key): boolean {
	const role = roleOf(g, k.row);
	return ALPHA.includes(role as (typeof ALPHA)[number]) && k.col >= 1;
}

export function charFor(g: Geometry, kmap: Keymap, k: Key): string {
	// A shared layout names this exact key, so its character wins outright. The row grid is the shape that
	// shipped before records existed and stays the fallback for the built-in boards.
	const named = kmap.byKey?.[k.id];
	if (named) return named;
	if (!isTaught(g, k)) return k.label;
	const role = roleOf(g, k.row) as "upper" | "home" | "lower";
	return kmap.rows[role]?.[k.hand][k.col] || k.label;
}

export function resolve(g: Geometry, kmap: Keymap): Resolved {
	const keys: RenderKey[] = [];
	const byId = new Map<string, RenderKey>();
	const byChar = new Map<string, string>();
	const problems = [...geometryProblems(g)];
	for (const k of g.keys) {
		const char = charFor(g, kmap, k);
		const rk: RenderKey = { ...k, char, finger: fingerOf(g, k), taught: false };
		keys.push(rk);
		byId.set(k.id, rk);
		// Untaught keys first: the keymap is allowed to overwrite these next.
		if ([...char].length === 1 && !isTaught(g, k)) byChar.set(char.toLowerCase(), k.id);
	}
	for (const k of keys) {
		if (!isTaught(g, k) || [...k.char].length !== 1) continue;
		k.taught = true;
		const c = k.char.toLowerCase();
		const other = byId.get(byChar.get(c) ?? "");
		if (other && isTaught(g, other)) problems.push(`"${c}" is on two keys (${other.id} and ${k.id})`);
		byChar.set(c, k.id);
	}
	const { width, height } = bounds(keys);
	return { geometry: g, keys, byId, byChar, viewBox: { x: -20, y: -20, width: width + 40, height: height + 40 }, problems };
}

// What a key should be called on screen. A space has to be spelled out -- it is the most-struck key on
// the board, and an invisible row label reads as a bug in the screen rather than as the space bar. A key
// with no character at all (an unmapped pinky column) falls back to its id, which is at least something
// to point at.
export function keyLabel(k: { id: string; char: string }): string {
	if (k.char === " ") return "space";
	return k.char.trim() === "" ? k.id : k.char;
}
