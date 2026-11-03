import { bounds, fingerOf, geometryProblems, roleOf } from "../keyboard/geometry.ts";
import type { Geometry, Key, Keymap, RenderKey, RowRole } from "../keyboard/types.ts";

export type Resolved = {
	keys: RenderKey[];
	byId: Map<string, RenderKey>;
	// Lowercased typed character -> key id. Only single-character labels are indexable.
	byChar: Map<string, string>;
	viewBox: { x: number; y: number; width: number; height: number };
	problems: string[];
};

const ALPHA = ["upper", "home", "lower"] as const;

// A key the keymap claims: one of the three touch-typing rows, and not the outer column.
function taught(g: Geometry, k: Key): boolean {
	const role = roleOf(g, k.row);
	return ALPHA.includes(role as (typeof ALPHA)[number]) && k.col >= 1;
}

export function charFor(g: Geometry, kmap: Keymap, k: Key): string {
	if (!taught(g, k)) return k.label;
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
		if ([...char].length === 1 && !taught(g, k)) byChar.set(char.toLowerCase(), k.id); // the keymap may overwrite these next
	}
	for (const k of keys) {
		if (!taught(g, k) || [...k.char].length !== 1) continue;
		k.taught = true;
		const c = k.char.toLowerCase();
		const other = byId.get(byChar.get(c) ?? "");
		if (other && taught(g, other)) problems.push(`"${c}" is on two keys (${other.id} and ${k.id})`);
		byChar.set(c, k.id);
	}
	const { width, height } = bounds(keys);
	return { keys, byId, byChar, viewBox: { x: -20, y: -20, width: width + 40, height: height + 40 }, problems };
}
