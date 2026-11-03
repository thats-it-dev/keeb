import type { Resolved } from "../keyboard/resolve.ts";
import { roleOf } from "../keyboard/geometry.ts";
import type { RenderKey } from "../keyboard/types.ts";
import { emptyStat, type StatMap } from "./stats.ts";

export type Ladder = {
	// Key ids in teaching order: home row first, then outward, alternating hands.
	order: string[];
	// The unlocked prefix of `order` — the keys the lesson may use.
	unlocked: string[];
	// The first locked key, or undefined when the board is fully unlocked.
	next?: string;
};

// A key needs this many samples before it can gate the next unlock. It must be well above the
// number of times each key appears in one lesson line, or the gate can never trip.
const MIN_SAMPLES = 10;

// Unlock strictly in teaching order: the next key opens when every key already unlocked is at the
// goal speed. Before any practice this is the two index keys, so lesson one is f and j.
export function ladder(r: Resolved, stats: StatMap, targetCpm: number): Ladder {
	const order = teachingOrder(r);
	// Only letter keys gate an unlock. The space bar is a thumb key that appears in every line, and
	// gating on it froze the ladder at the first two keys.
	const gate = order.filter((id) => /^[a-z]$/i.test(r.byId.get(id)?.char ?? ""));
	let end = 0;
	while (end + 1 < gate.length && gate.slice(0, end + 1).every((id) => ready(id, stats, targetCpm))) end += 1;
	// Before any practice there is nothing to gate on, so the lesson starts on both index keys.
	const unlocked = end === 0 ? gate.slice(0, 2) : gate.slice(0, end + 1);
	return { order, unlocked, next: gate[unlocked.length] };
}

export function ready(id: string | undefined, stats: StatMap, targetCpm: number): boolean {
	if (!id) return false;
	const s = stats[id] ?? emptyStat();
	const goal = targetCpm <= 0 ? 0 : Math.round(60000 / targetCpm);
	if (s.samples < MIN_SAMPLES || goal === 0) return false;
	return goal * s.samples >= s.ttMs16 / 16;
}

// Index fingers first (f and j), then out-and-down across the board. This is the order a typing
// course uses, and it is derived from row roles so it holds on a Go60, a Corne and a 60% alike.
function teachingOrder(r: Resolved): string[] {
	const taught = r.keys.filter((k) => k.taught);
	const rows = ["home", "upper", "lower"] as const;
	const cols = [4, 3, 2, 1, 0, 5]; // index inside, then outward, then the second index column
	const out: string[] = [];
	for (const role of rows) {
		for (const col of cols) {
			for (const hand of ["l", "r"] as const) {
				const k = taught.find((x) => x.hand === hand && x.col === col && rowRole(r, x) === role);
				if (k && !out.includes(k.id)) out.push(k.id);
			}
		}
	}
	return out;
}

function rowRole(r: Resolved, k: RenderKey) {
	return roleOf(r.geometry, k.row);
}
