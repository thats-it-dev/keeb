// The route model: one route per typable character, saying which (key, layer) the lesson teaches it on.
import { routeId } from "../stats/stats.ts";

export type Route = { char: string; keyId: string; layer: number; statId: string };

// One (char, key, layer) the map says you could type, with everything the ranking needs already measured
// against the geometry, so the comparison itself is pure data.
export type Candidate = { char: string; keyId: string; layer: number; taught: boolean; distanceToHome: number; matrixIndex: number };

// A taught key always beats an untaught one -- that is why the digit 7 lives on a home-cluster layer key
// and not on the number row. Among taught occurrences the shortest reach from the home row wins; the
// remaining ties (layer, matrix position, key id) exist only to make the result order-independent.
export function pickRoutes(candidates: Candidate[]): Route[] {
	const best = new Map<string, Candidate>();
	for (const c of candidates) {
		const cur = best.get(c.char);
		if (!cur || compare(cur, c) > 0) best.set(c.char, c);
	}
	return [...best.values()]
		.sort((a, b) => (a.char < b.char ? -1 : a.char > b.char ? 1 : 0))
		.map((c) => ({ char: c.char, keyId: c.keyId, layer: c.layer, statId: routeId(c.layer, c.keyId) }));
}

// The canonical stat key lives in stats.ts (routeId); this module only decides which candidate earns it.

// Negative when `a` is the better route. Infinity distances only ever lose to finite ones, and two
// Infinities tie on the later terms, so no arithmetic on Infinity happens.
function compare(a: Candidate, b: Candidate): number {
	return (
		Number(b.taught) - Number(a.taught) ||
		a.distanceToHome - b.distanceToHome ||
		a.layer - b.layer ||
		a.matrixIndex - b.matrixIndex ||
		(a.keyId < b.keyId ? -1 : a.keyId > b.keyId ? 1 : 0)
	);
}

// What the board needs to draw one lit route: the key, the layer colour, and the physical key whose
// picture says how the layer gets opened. Purely derived from parent state -- never read off the DOM.
export type RouteView = { keyId: string; layer: number; ringId: string; char: string };

export function routeOf(r: { routeChars: Map<string, Route>; layerKeyOf: Map<number, string> }, char: string): RouteView | undefined {
	const x = char === "" ? undefined : r.routeChars.get(char.toLowerCase());
	if (!x) return undefined;
	return { keyId: x.keyId, layer: x.layer, ringId: x.layer === 0 ? "" : (r.layerKeyOf.get(x.layer) ?? ""), char: x.char };
}
