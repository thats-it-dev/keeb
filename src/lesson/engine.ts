import { lesson } from "./generator.ts";
import { ladder, type Ladder, type LadderOptions } from "./ladder.ts";
import type { Resolved } from "../keyboard/resolve.ts";
import { emptyStat, observe, type KeyStat, type StatMap } from "../stats/stats.ts";

/** Everything about the learner that a line depends on, in one object, so no keystroke has to carry five
 *  positional arguments and agree with the line that started before them. */
export type Course = {
	resolved: Resolved;
	targetCpm: number;
} & LadderOptions & {
	/** Practise corpus words instead of model words. */
	realWords?: boolean;
};

export type Engine = {
	stats: StatMap;
	// The words currently on screen.
	text: string;
	index: number;
	// Key id we are waiting for, "" when the run is done.
	pending: string;
	// Timestamp of the previous keystroke, 0 before the first one.
	stamp: number;
	// How many lines this course has placed. It seeds the generator, so a line is reproducible.
	line: number;
	ladder: Ladder;
};

export type KeyResult = {
	engine: Engine;
	// False when the learner hit the wrong key; the engine then repeats it.
	accepted: boolean;
	targetId: string;
	// The key that was actually pressed, which is what the keyboard should light up. Falls back to the
	// expected key when the character is not on this board.
	pressedId: string;
	elapsedMs: number;
	// True when this keystroke finished the run.
	finished: boolean;
};

export function start(course: Course, stats: StatMap): Engine {
	return place(course, { stats, ladder: ladder(course.resolved, stats, course.targetCpm, course), text: "", index: 0, pending: "", stamp: 0, line: 0 });
}

// One keystroke. Timing is attributed to the key that was expected: on a remapped split the browser's
// physical code says nothing about the position, but the expected character always does.
export function press(course: Course, e: Engine, typed: string, now: number): KeyResult {
	const targetId = e.pending;
	const elapsedMs = e.stamp === 0 ? 0 : Math.max(0, now - e.stamp);
	const correct = typed === want(e) && targetId !== "";
	// A wrong key is charged to the key that was asked for, not to whatever finger slipped.
	const id = targetId;
	const stat = recordStroke(e.stats[id] ?? emptyStat(), correct, elapsedMs);
	const stats = { ...e.stats, [id]: stat };
	const index = correct ? e.index + 1 : e.index;
	// Highlighting follows the fingers, not the lesson: the key that was struck is the one that glows.
	const pressedId = idOf(course.resolved, typed) || targetId;
	const advanced: Engine = { ...e, stats, index };
	if (index >= [...e.text].length) {
		// A new run. `stamp` resets to 0 so the pause between runs is never charged to a key.
		return { engine: { ...place(course, advanced), stamp: 0 }, accepted: correct, targetId: id, pressedId, elapsedMs, finished: true };
	}
	return { engine: { ...advanced, pending: idOf(course.resolved, [...e.text][index] ?? ""), stamp: now }, accepted: correct, targetId: id, pressedId, elapsedMs, finished: false };
}

function want(e: Engine): string {
	return [...e.text][e.index] ?? "";
}

function idOf(r: Resolved, char: string): string {
	return r.byChar.get(char.toLowerCase()) ?? "";
}

/** One EWMA, in stats.ts, for every reader of progress: two copies of the update rule would disagree about
 *  what an unmeasurable interval means. A miss is the same observation plus one error. */
function recordStroke(stat: KeyStat, correct: boolean, elapsedMs: number): KeyStat {
	const next = observe(stat, elapsedMs);
	return correct ? next : { ...next, errors: next.errors + 1 };
}

// A new line: re-derive the curriculum from the stats, build the line from the letters it opened, and name
// the key we are waiting for.
function place(course: Course, e: Engine): Engine {
	const l = ladder(course.resolved, e.stats, course.targetCpm, course);
	const letters = l.unlocked.map((id) => course.resolved.byId.get(id)?.char.toLowerCase() ?? "").filter(Boolean);
	const focus = l.focus === undefined ? undefined : course.resolved.byId.get(l.focus)?.char.toLowerCase();
	const { text } = lesson({
		letters,
		focus,
		stats: e.stats,
		targetCpm: course.targetCpm,
		ids: course.resolved.byChar,
		realWords: course.realWords ?? false,
		seed: e.line + 1,
	});
	return { ...e, ladder: l, text, index: 0, line: e.line + 1, pending: idOf(course.resolved, [...text][0] ?? ""), stamp: 0 };
}

export type { Engine as LessonEngine };
