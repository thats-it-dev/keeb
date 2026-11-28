// The curriculum. Which letters are in the lesson, which one the lesson is built around, and which one
// comes next — derived from the corpus and the learner's own numbers, never remembered between lines.
//
// Three rules carry it, and they are the whole difference from a course that teaches the home row first:
//
//  - you start with the six letters the language uses most, because six letters are enough to spell
//    something, and a lesson that cannot make a word is a lesson of noise;
//  - the next letter arrives when every letter you already have has been at goal speed *at some point* —
//    best confidence, not this week's;
//  - the weakest letter you have is the one every line is built around.

import { roleOf } from "../keyboard/geometry.ts";
import type { Resolved } from "../keyboard/resolve.ts";
import { bestConfidence, confidence, emptyStat, type StatMap } from "../stats/stats.ts";
import { frequencyOrder } from "./model.ts";
import { SYMBOL_ORDER } from "./symbols.ts";

/** Letters a brand new learner is given. Below this the language cannot be spelled at all. */
export const START_SIZE = 6;

export type LadderKey = {
	id: string;
	char: string;
	/** This key's own speed against the goal, right now. */
	confidence: number;
	/** The best it has ever been. This is what unlocks the next letter. */
	best: number;
	included: boolean;
};

export type Ladder = {
	/** Key ids in teaching order. */
	order: string[];
	/** The included keys of `order` — the letters the lesson may use. */
	unlocked: string[];
	/** The weakest included key: the letter every line is built around. */
	focus?: string;
	/** The first locked key, or undefined when the board is fully unlocked. */
	next?: string;
	/** The same decisions per key, for a screen that wants to show them. */
	keys: LadderKey[];
};

export type LadderOptions = {
	/** Teach in keyboard order (cheapest row first) instead of language-frequency order. */
	keyboardOrder?: boolean;
};

export function ladder(r: Resolved, stats: StatMap, targetCpm: number, options: LadderOptions = {}): Ladder {
	const keys: LadderKey[] = teachingOrder(r, options.keyboardOrder ?? false).map((id) => {
		const stat = stats[id] ?? emptyStat();
		return {
			id,
			char: r.byStat.get(id)!.char,
			confidence: confidence(stat, targetCpm),
			best: bestConfidence(stat, targetCpm),
			included: false,
		};
	});

	// Walk the letters in teaching order. One joins when it has been good enough once before, or when
	// everything already in the lesson has — and that second clause is what makes letters arrive singly,
	// because a letter just handed out has never been good enough at all.
	for (const key of keys) {
		const included = keys.filter((k) => k.included);
		if (included.length < START_SIZE || key.best >= 1 || included.every((k) => k.best >= 1)) key.included = true;
	}

	const unlocked = keys.filter((k) => k.included);
	// The weakest of what you have, and only a letter: spec §5 makes the focused key always a letter the
	// learner already has, because the line is built around it as a hard constraint. A layer token is
	// struck as its own one-character word, so it is never the focus — that is what keeps a finished
	// alphabet from being drilled through a junk line of tokens. Ties go to the slower of the two today, so a
	// key that is both slow and unreliable comes before one that is merely having a bad week.
	const focus = [...unlocked]
		.filter((k) => /^[a-z]$/.test(k.char))
		.sort((a, b) => a.best - b.best || a.confidence - b.confidence)
		.find((k) => k.best < 1);

	return {
		order: keys.map((k) => k.id),
		unlocked: unlocked.map((k) => k.id),
		focus: focus?.id,
		next: keys.find((k) => !k.included)?.id,
		keys,
	};
}

/** The typable characters of this layout, in the order the lesson hands them out, as stat ids.
 *
 * Both modes keep the same bands: every taught base letter (and any letter route on a layer) first, then
 * every layer character — a layer is a poor fit for a brand-new typist, so nothing in it opens until the
 * alphabet is dealt. Letters come from the taught keys. In `keyboardOrder` the letters are a cost ranking,
 * not a finger path: home row, then upper row, then the rest — and inside a row, most frequent letter
 * first. That is the same weighting keybr gives its keyboard layout, and it keeps the two orders honest
 * about the thing they have in common, which is that both start with letters that make words possible.
 * The default sorts the same letters by corpus frequency, ties by code point. The one band below the
 * alphabet is measured, not alphabetical, in both modes: `SYMBOL_ORDER` (scripts/make-symbols.ts) ranks
 * every character a sample of written English could see, and what it could not see keeps the code-point
 * order at the very tail. (Routes are always single characters — `resolve.ts` refuses multi-character
 * bindings — so there is no token band to rank.)
 */
export function teachingOrder(r: Resolved, keyboardOrder: boolean): string[] {
	const routes = r.routes.filter((x) => x.layer > 0 || (/^[a-z]$/.test(x.char) && r.byId.get(x.keyId)!.taught));
	const freq = frequencyOrder();
	const rank = new Map(freq.map((ch, i) => [ch, i]));
	const rankOf = (ch: string): number => {
		const letter = rank.get(ch);
		if (letter !== undefined) return letter;
		const sym = SYMBOL_ORDER.indexOf(ch); // band 2: characters ranked by measured use
		if (sym >= 0) return freq.length + 1 + sym;
		return freq.length + 1 + SYMBOL_ORDER.length; // band 3: what the sample never printed — tie-break below
	};
	const cost = (x: (typeof routes)[number]) => {
		const role = roleOf(r.geometry, r.byId.get(x.keyId)!.row);
		return role === "home" ? 1 : role === "upper" ? 2 : r.byId.get(x.keyId)!.taught ? 3 : 4;
	};
	const letters = routes.filter((x) => /^[a-z]$/.test(x.char));
	const symbols = routes.filter((x) => !/^[a-z]$/.test(x.char));
	const sortedLetters = [...letters].sort((a, b) =>
		keyboardOrder
			? cost(a) - cost(b) || rankOf(a.char) - rankOf(b.char) || (a.char < b.char ? -1 : 1)
			: rankOf(a.char) - rankOf(b.char) || (a.char < b.char ? -1 : 1),
	);
	const sortedSymbols = [...symbols].sort(
		(a, b) => rankOf(a.char) - rankOf(b.char) || (a.char < b.char ? -1 : 1),
	);
	return [...sortedLetters, ...sortedSymbols].map((x) => x.statId);
}
