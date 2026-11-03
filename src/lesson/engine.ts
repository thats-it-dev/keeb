import type { Resolved } from "../keyboard/resolve.ts";
import { emptyStat, type StatMap } from "../stats/stats.ts";
import { ladder } from "../stats/ladder.ts";
import { lesson } from "../lesson/generator.ts";

export type Engine = {
	stats: StatMap;
	// The word list currently on screen.
	text: string;
	index: number;
	// Key id we are waiting for, "" when the run is done.
	pending: string;
	// Timestamp of the previous keystroke, 0 before the first one.
	stamp: number;
	ladder: ReturnType<typeof ladder>;
};

export type KeyResult = {
	engine: Engine;
	// False when the learner hit the wrong key; the engine then repeats it.
	accepted: boolean;
	targetId: string;
	elapsedMs: number;
	// True when this keystroke finished the run.
	finished: boolean;
};

export function start(r: Resolved, stats: StatMap, targetCpm: number): Engine {
	const l = ladder(r, stats, targetCpm);
	return place(r, { stats, ladder: l, text: "", index: 0, pending: "", stamp: 0 }, targetCpm);
}

// One keystroke. Timing is attributed to the key that was expected: on a remapped split the browser's
// physical code says nothing about the position, but the expected character always does.
export function press(e: Engine, r: Resolved, typed: string, now: number, targetCpm: number): KeyResult {
	const targetId = e.pending;
	const elapsedMs = e.stamp === 0 ? 0 : Math.max(0, now - e.stamp);
	const correct = typed === want(e) && targetId !== "";
	// A wrong key is charged to the key that was asked for, not to whatever finger slipped.
	const id = targetId;
	const stat = correct ? bump(e.stats[id] ?? emptyStat(), elapsedMs) : markError(e.stats[id] ?? emptyStat());
	const stats = { ...e.stats, [id]: stat };
	const index = correct ? e.index + 1 : e.index;
	const advanced: Engine = { ...e, stats, index, ladder: e.ladder };
	if (index >= [...e.text].length) {
		// A new run. `stamp` resets to 0 so the pause between runs is never charged to a key.
		return { engine: { ...place(r, advanced, targetCpm), stamp: 0 }, accepted: correct, targetId: id, elapsedMs, finished: true };
	}
	return { engine: { ...advanced, pending: idOf(r, [...e.text][index] ?? ""), stamp: now }, accepted: correct, targetId: id, elapsedMs, finished: false };
}

function want(e: Engine): string {
	return [...e.text][e.index] ?? "";
}

function idOf(r: Resolved, char: string): string {
	return r.byChar.get(char.toLowerCase()) ?? "";
}

// Fixed-point EWMA, same as stats.observe: 1/16 weight on the newest sample.
function bump(stat: { ttMs16: number; samples: number; errors: number }, elapsedMs: number) {
	const s = Math.max(0, Math.round(elapsedMs)) * 16;
	return { ttMs16: stat.samples === 0 ? s : stat.ttMs16 + (s - stat.ttMs16) / 16, samples: stat.samples + 1, errors: stat.errors };
}

function markError(stat: { ttMs16: number; samples: number; errors: number }) {
	return { ...stat, errors: stat.errors + 1 };
}

// A new run: unlock according to the stats, build the next line from what is unlocked, and set the
// first pending key.
function place(r: Resolved, e: Engine, targetCpm: number): Engine {
	const l = ladder(r, e.stats, targetCpm);
	const letters = l.unlocked.map((id) => r.byId.get(id)?.char.toLowerCase() ?? "").filter(Boolean);
	const text = lesson(letters, e.stats, targetCpm, r.byChar).text;
	return { ...e, ladder: l, text, index: 0, pending: idOf(r, [...text][0] ?? ""), stamp: 0 };
}

export type { Engine as LessonEngine };
