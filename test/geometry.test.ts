import { describe, expect, it } from "vitest";
import { ANSI60 } from "../src/data/ansi60.ts";
import { CORNE } from "../src/data/corne.ts";
import { GO60 } from "../src/data/go60.ts";
import { LILY58 } from "../src/data/lily58.ts";
import { bounds, fingerOf, geometryProblems, roleOf } from "../src/keyboard/geometry.ts";
import { keymapById } from "../src/data/keymaps.ts";
import { resolve } from "../src/keyboard/resolve.ts";
import type { Geometry, RenderKey } from "../src/keyboard/types.ts";

const ALL: Geometry[] = [GO60, ANSI60, CORNE, LILY58];
const rById = (r: { byId: Map<string, RenderKey> }, id: string) => r.byId.get(id)!;

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
		for (const g of ALL.filter((x) => x.split)) {
			const left = Math.max(...g.keys.filter((k) => k.hand === "l").map((k) => k.x + k.w));
			const right = Math.min(...g.keys.filter((k) => k.hand === "r").map((k) => k.x));
			expect(right, g.id).toBeGreaterThan(left);
		}
	});

	it("a staggered board keeps the no-overlap rule only inside each row", () => {
		const rows = new Map<number, number>();
		for (const k of ANSI60.keys) rows.set(k.row, Math.max(rows.get(k.row) ?? 0, k.x + k.w));
		expect([...rows.values()]).toEqual([1500, 1500, 1500, 1500, 1375]); // every row spans the same 15u
	});

	it("names the ansi keys with the codes the browser reports", () => {
		const r = resolve(ANSI60, keymapById("qwerty"));
		expect(r.byChar.get("q")).toBe("KeyQ");
		expect(r.byChar.get(" ")).toBe("Space");
		expect(r.keys.filter((k) => k.taught)).toHaveLength(30);
		expect(rById(r, "Enter")!.finger).toBe("rp");
		expect(rById(r, "KeyH")!.finger).toBe("ri");
	});

	it("orders columns outward-to-inward on each hand", () => {
		for (const g of ALL.filter((x) => x.split)) {
			for (const hand of ["l", "r"] as const) {
				const byCol = new Map<number, number>();
				for (const k of g.keys.filter((k) => k.hand === hand && roleOf(g, k.row) !== "thumb")) {
					const prev = byCol.get(k.col);
					if (prev !== undefined) continue;
					byCol.set(k.col, k.x);
				}
				const cols = [...byCol.entries()].sort((a, b) => a[0] - b[0]);
				const xs = cols.map(([, x]) => x);
				const ordered = hand === "l" ? xs : [...xs].reverse();
				expect(ordered, `${g.id} ${hand}`).toEqual([...ordered].sort((a, b) => a - b));
				expect(new Set(xs).size, `${g.id} ${hand} columns sit on top of each other`).toBe(xs.length);
			}
		}
	});

	it("draws 58 thumb-and-finger keys on the lily58 without stacking them", () => {
		const boxes = LILY58.keys.map((k) => ({ x1: k.x, x2: k.x + k.w, y1: k.y, y2: k.y + k.h }));
		for (let i = 0; i < boxes.length; i += 1) {
			for (let j = i + 1; j < boxes.length; j += 1) {
				const a = boxes[i];
				const b = boxes[j];
				const overlap = a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
				expect(overlap, `${i} vs ${j}`).toBe(false);
			}
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
