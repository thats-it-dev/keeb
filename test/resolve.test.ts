import { describe, expect, it } from "vitest";
import { GEOMETRIES } from "../src/data/geometries.ts";
import { KEYMAPS } from "../src/data/keymaps.ts";
import { geometryById } from "../src/data/geometries.ts";
import { keymapById } from "../src/data/keymaps.ts";
import { charFor, resolve } from "../src/keyboard/resolve.ts";
import { roleOf } from "../src/keyboard/geometry.ts";

const GO = geometryById("go60");

describe("resolve", () => {
	it("finds the physical key behind a typed character on the Go60 factory map", () => {
		const r = resolve(GO, keymapById("qwerty"));
		expect(r.byId.get(r.byChar.get("a")!)?.label).toBe("a");
		expect(r.byChar.get("a")).toBe("L_C5R3");
		expect(r.byChar.get("n")).toBe("R_C1R4");
		expect(r.byChar.get(" ")).toBe("R_T2"); // the Go60 space bar is a thumb key
	});

	it("re-maps the same physical board to Colemak-DH", () => {
		const r = resolve(GO, keymapById("colemak-dh"));
		expect(r.byChar.get("t")).toBe("L_C2R3"); // home row, left index
		expect(r.byChar.get("n")).toBe("R_C2R3"); // home row, right index
		expect(r.byId.get(r.byChar.get("d")!)!.row).toBe(3); // curled onto the lower row
	});

	it.each([GO, ...GEOMETRIES.filter((g) => g.id !== "go60")])("%s numbers stay on the board, not the keymap", (g) => {
		const row = g.keys.filter((k) => roleOf(g, k.row) === "number");
		if (row.length === 0) return;
		expect(charFor(g, keymapById("dvorak"), row.find((k) => k.col === 3 && k.hand === "l")!)).toBe("3");
	});

	it("pairs every shipped geometry with every keymap without a conflict", () => {
		for (const g of GEOMETRIES) {
			for (const m of KEYMAPS) {
				const r = resolve(g, m);
				expect(r.problems, `${g.id} + ${m.id}`).toEqual([]);
				expect(r.byChar.size).toBeGreaterThan(26);
			}
		}
	});

	it("gives the renderer a box that holds the whole board", () => {
		const r = resolve(GO, keymapById("qwerty"));
		expect(r.viewBox.width).toBeGreaterThan(Math.max(...r.keys.map((k) => k.x + k.w)));
		expect(r.viewBox.height).toBeGreaterThan(Math.max(...r.keys.map((k) => k.y + k.h)));
	});
});
