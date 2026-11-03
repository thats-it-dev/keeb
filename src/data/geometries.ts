import { ANSI60 } from "./ansi60.ts";
import { CORNE } from "./corne.ts";
import { GO60 } from "./go60.ts";
import { LILY58 } from "./lily58.ts";
import type { Geometry } from "../keyboard/types.ts";

export const GEOMETRIES: Geometry[] = [GO60, ANSI60, CORNE, LILY58];

export function geometryById(id: string): Geometry {
	return GEOMETRIES.find((g) => g.id === id) ?? GEOMETRIES[0];
}
