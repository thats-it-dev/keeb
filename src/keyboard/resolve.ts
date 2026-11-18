import { bounds, fingerOf, geometryProblems, roleOf } from "../keyboard/geometry.ts";
import { pickRoutes, type Candidate, type Route } from "../keyboard/routes.ts";
import type { Geometry, Hand, Key, Keymap, RenderKey } from "../keyboard/types.ts";

export type Resolved = {
	geometry: Geometry;
	keys: RenderKey[];
	byId: Map<string, RenderKey>;
	// Lowercased typed character -> key id. Only single-character labels are indexable.
	byChar: Map<string, string>;
	// One route per typable character, whichever layer produces it; byStat keys the same routes by stat id.
	routes: Route[];
	routeChars: Map<string, Route>;
	byStat: Map<string, Route>;
	// Layer display names by layer index ("" where the file skipped a number), [] for a base-only map.
	layerNames: string[];
	// Which physical key opens which layer (target layer -> key id), from the keymap's layer-tap bindings.
	layerKeyOf: Map<number, string>;
	// Key id for Enter, so the board lights it when the learner advances.
	enterKey: string | undefined;
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
	// A shared layout or a keycap file's main layer names this exact key, so its character wins outright
	// -- control taps included ("&lt 1 RET" makes that thumb an Enter key, whatever the shipped geometry
	// labels it). The row grid is the shape that shipped before records existed and stays the fallback
	// for the built-in boards.
	const named = kmap.byKey?.[k.id] ?? kmap.layers?.find((l) => l.index === 0)?.byKeyId[k.id];
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
	const distance = homeDistance(g);
	const candidates: Candidate[] = [];
	for (const [matrixIndex, k] of g.keys.entries()) {
		const char = charFor(g, kmap, k);
		const rk: RenderKey = { ...k, char, finger: fingerOf(g, k), taught: false, glyphs: [] };
		keys.push(rk);
		byId.set(k.id, rk);
		if ([...char].length === 1) {
			const c = char.toLowerCase();
			rk.glyphs.push({ char: c, layer: 0 });
			candidates.push({ char: c, keyId: k.id, layer: 0, taught: isTaught(g, k), distanceToHome: distance(k), matrixIndex });
		}
		// Untaught keys first: the keymap is allowed to overwrite these next.
		if ([...char].length === 1 && !isTaught(g, k)) byChar.set(char.toLowerCase(), k.id);
	}
	for (const layer of kmap.layers ?? []) {
		if (layer.index === 0) continue; // its characters already came off the geometry
		for (const [keyId, char] of Object.entries(layer.byKeyId)) {
			const k = byId.get(keyId);
			if (!k || [...char].length !== 1 || char === " ") continue; // the space bar is one key on every board; a layer's SPACE changes no route
			const c = char.toLowerCase();
			if (!k.glyphs.some((x) => x.char === c)) k.glyphs.push({ char: c, layer: layer.index });
			candidates.push({ char: c, keyId, layer: layer.index, taught: isTaught(g, k), distanceToHome: distance(k), matrixIndex: g.keys.indexOf(k) });
		}
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
	const enterKey = keys.find((k) => k.label === "Enter" || k.char === "Enter")?.id;
	const routes = pickRoutes(candidates);
	const routeChars = new Map(routes.map((x) => [x.char, x]));
	const byStat = new Map(routes.map((x) => [x.statId, x]));
	for (const x of routes) byChar.set(x.char, x.keyId); // highlighting follows the route the lesson teaches
	const layerNames: string[] = [];
	for (const l of kmap.layers ?? []) layerNames[l.index] = l.name;
	const layerKeyOf = new Map<number, string>();
	for (const lk of kmap.layerKeys ?? []) if (!layerKeyOf.has(lk.layer)) layerKeyOf.set(lk.layer, lk.keyId);
	return { geometry: g, keys, byId, byChar, routes, routeChars, byStat, layerNames, layerKeyOf, enterKey, viewBox: { x: -20, y: -20, width: width + 40, height: height + 40 }, problems };
}

// How far each key is from where the hand rests, per hand. Keys the lesson never teaches (thumb rows,
// function rows, the outer pinky column) are Infinity away: they only surface when nothing else can.
function homeDistance(g: Geometry): (k: Key) => number {
	const centers = new Map<Hand, { x: number; y: number }>();
	for (const hand of ["l", "r"] as const) {
		const home = g.keys.filter((k) => k.hand === hand && roleOf(g, k.row) === "home" && k.col >= 1);
		if (home.length > 0) {
			const sum = home.reduce((acc, k) => ({ x: acc.x + (k.x + k.w / 2) / home.length, y: acc.y + (k.y + k.h / 2) / home.length }), { x: 0, y: 0 });
			centers.set(hand, sum);
		}
	}
	return (k) => {
		const role = roleOf(g, k.row);
		if (!ALPHA.includes(role as (typeof ALPHA)[number]) || k.col === 0) return Infinity;
		const here = centers.get(k.hand) ?? centers.get(k.hand === "l" ? "r" : "l");
		if (!here) return Infinity;
		return Math.hypot(k.x + k.w / 2 - here.x, k.y + k.h / 2 - here.y);
	};
}

// What a key should be called on screen. A space has to be spelled out -- it is the most-struck key on
// the board, and an invisible row label reads as a bug in the screen rather than as the space bar. A key
// with no character at all (an unmapped pinky column) falls back to its id, which is at least something
// to point at.
export function keyLabel(k: { id: string; char: string }): string {
	if (k.char === " ") return "space";
	return k.char.trim() === "" ? k.id : k.char;
}
