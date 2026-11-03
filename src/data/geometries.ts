import { ANSI60 } from "./ansi60.ts";
import { CORNE } from "./corne.ts";
import { GO60 } from "./go60.ts";
import { LILY58 } from "./lily58.ts";
import type { Geometry } from "../keyboard/types.ts";

export const GEOMETRIES: Geometry[] = [GO60, ANSI60, CORNE, LILY58];

// Boards the learner imported from their own layout file, in arrival order. Kept apart from the
// shipped list so geometry tests only ever see what we checked by hand.
const imported: Geometry[] = [];

export function allGeometries(): Geometry[] {
	return [...GEOMETRIES, ...imported];
}

// A board whose id is already taken would quietly replace the other one in the picker, so the caller
// hears about the collision instead of finding out from the render.
export function registerGeometry(g: Geometry): boolean {
	if (allGeometries().some((o) => o.id === g.id)) return false;
	imported.push(g);
	return true;
}

export function forgetGeometry(id: string): void {
	const at = imported.findIndex((g) => g.id === id);
	if (at >= 0) imported.splice(at, 1);
}

export function geometryById(id: string): Geometry {
	return allGeometries().find((g) => g.id === id) ?? GEOMETRIES[0];
}
