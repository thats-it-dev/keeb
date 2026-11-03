import type { Resolved } from "../keyboard/resolve.ts";
import { roleOf } from "../keyboard/geometry.ts";
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
// Unlock in teaching order: the next key opens when every unlocked key is at the goal speed.
// The starting group is the whole home row, which is both how typing courses begin and the point
// where real English words become possible (35+ of them from a s d f g h j k l ; alone).
export function ladder(r: Resolved, stats: StatMap, targetCpm: number): Ladder {
	const order = teachingOrder(r);
	// Only letter keys gate an unlock. The space bar is a thumb key that appears in every line, and
	// gating on it froze the ladder at the first two keys.
	const gate = order.filter((id) => /^[a-z]$/i.test(r.byId.get(id)?.char ?? ""));
	const home = gate.filter((id) => roleById(r, id) === "home");
	let end = Math.max(0, home.length - 1);
	// Advance while every key that has actually been practised is at the goal speed. A key with no
	// samples must not block: the home row spells 35 common words and none of them use j or k, so
	// demanding reps on those two first would deadlock the ladder at nine keys.
	while (end + 1 < gate.length) {
		const practised = gate.slice(0, end + 1).filter((id) => ((stats[id] ?? emptyStat()).samples >= MIN_SAMPLES));
		if (practised.length === 0 || !practised.every((id) => ready(id, stats, targetCpm))) break;
		end += 1;
	}
	const unlocked = home.length > 1 ? gate.slice(0, end + 1) : gate.slice(0, Math.max(2, end + 1));
	return { order, unlocked, next: gate[unlocked.length] };
}

function roleById(r: Resolved, id: string) {
	const k = r.byId.get(id);
	return k ? roleOf(r.geometry, k.row) : "extra";
}

export function ready(id: string | undefined, stats: StatMap, targetCpm: number): boolean {
	if (!id) return false;
	const s = stats[id] ?? emptyStat();
	const goal = targetCpm <= 0 ? 0 : Math.round(60000 / targetCpm); // ms per key
	if (s.samples < MIN_SAMPLES || goal === 0) return false;
	// ttMs16 is the mean in ms x 16, so compare against goal x 16. Multiplying by samples here
	// made every key pass after two samples, no matter how slow the learner was.
	return goal * 16 >= s.ttMs16;
}

// Home row first (the keys a beginner is placed on), then out-and-down across the board. Derived
// from row roles, so it holds on a Go60, a Corne, a Lily58 and a staggered 60% alike.
function teachingOrder(r: Resolved): string[] {
	const taught = r.keys.filter((k) => k.taught);
	const rows = ["home", "upper", "lower"] as const;
	const cols = [4, 3, 2, 1, 0, 5]; // index inside, then outward, then the second index column
	const out: string[] = [];
	for (const role of rows) {
		for (const col of cols) {
			for (const hand of ["l", "r"] as const) {
				const k = taught.find((x) => x.hand === hand && x.col === col && roleOf(r.geometry, x.row) === role);
				if (k && !out.includes(k.id)) out.push(k.id);
			}
		}
	}
	return out;
}
