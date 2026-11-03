import { describe, expect, it } from "vitest";
import { CORNE } from "../src/data/corne.ts";
import { GO60 } from "../src/data/go60.ts";
import { LILY58 } from "../src/data/lily58.ts";
import { bounds, fingerOf, geometryProblems, roleOf } from "../src/keyboard/geometry.ts";
import type { Geometry } from "../src/keyboard/types.ts";

const ALL: Geometry[] = [GO60, CORNE, LILY58];

describe("geometries", () => {
	it.each(ALL)("$id is self-consistent", (g) => {
		expect(geometryProblems(g)).toEqual([]);
	});

	it("go60 has every key of the real board", () => {
		expect(GO60.keys).toHaveLength(60);
		expect(GO60.keys.filter((k) => k.hand === "l")).toHaveLength(30);
		expect(GO60.keys.filter((k) => roleOf(GO60, k.row) === "thumb")).toHaveLength(6);
		expect(GO60.keys.filter((k) => k.rot !== 0)).toHaveLength(6); // the curved thumb clusters
	});

	it.each([CORNE, LILY58])("$name key count", (g) => {
		expect(g.keys).toHaveLength(g.id === "corne" ? 42 : 58);
	});

	it("coordinates are integers, because atproto has no float type", () => {
		for (const g of ALL) for (const k of g.keys) expect([k.x, k.y, k.w, k.h, k.rot].every(Number.isInteger)).toBe(true);
	});

	it("the two halves of a split do not overlap", () => {
		for (const g of ALL) {
			const left = Math.max(...g.keys.filter((k) => k.hand === "l").map((k) => k.x + k.w));
			const right = Math.min(...g.keys.filter((k) => k.hand === "r").map((k) => k.x));
			expect(right).toBeGreaterThan(left);
		}
	});

	it("every key sits inside the drawn box", () => {
		for (const g of ALL) {
			const { width, height } = bounds(g.keys);
			expect(width).toBeGreaterThan(1000);
			expect(height).toBeGreaterThan(400);
		}
	});

	it("assigns fingers by column", () => {
		const at = (g: Geometry, id: string) => fingerOf(g, g.keys.find((k) => k.id === id)!);
		expect(at(GO60, "L_C5R3")).toBe("lp"); // A
		expect(at(GO60, "L_C4R3")).toBe("lr"); // S
		expect(at(GO60, "L_C3R3")).toBe("lm"); // D
		expect(at(GO60, "L_C2R3")).toBe("li"); // F
		expect(at(GO60, "L_C1R3")).toBe("li"); // G, also index
		expect(at(GO60, "R_C1R2")).toBe("ri"); // Y
		expect(at(GO60, "R_C6R1")).toBe("rp"); // -
		expect(at(GO60, "L_T1")).toBe("lt");
	});
});
