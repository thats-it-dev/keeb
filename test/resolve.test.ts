import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GEOMETRIES } from "../src/data/geometries.ts";
import { KEYMAPS } from "../src/data/keymaps.ts";
import { geometryById } from "../src/data/geometries.ts";
import { keymapById } from "../src/data/keymaps.ts";
import { keymapFromKeycap, type KeycapBinding, type KeycapFile } from "../src/layout/keycap.ts";
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

	it("separates the keys a keymap claims from the ones the board owns", () => {
		const r = resolve(GO, keymapById("qwerty"));
		expect(r.byId.get("L_C5R3")!.taught).toBe(true); // a
		expect(r.byId.get("L_C6R2")!.taught).toBe(false); // Tab, the outer column
		expect(r.byId.get("R_T2")!.taught).toBe(false); // space, a thumb key
		expect(r.keys.filter((k) => k.taught)).toHaveLength(30);
	});

	it("gives the renderer a box that holds the whole board", () => {
		const r = resolve(GO, keymapById("qwerty"));
		expect(r.viewBox.width).toBeGreaterThan(Math.max(...r.keys.map((k) => k.x + k.w)));
		expect(r.viewBox.height).toBeGreaterThan(Math.max(...r.keys.map((k) => k.y + k.h)));
	});

	it("lets a shared layout's per-key characters outrank the row grid", () => {
		// A shared record says what each physical key produces, so it wins over the position grid -- including on
		// a home-row key, where the grid would otherwise have the final word. The character has an accent because
		// every plain one is already claimed by some key on this board, and byChar would then describe whichever
		// registered last rather than the key under test (that collision is what this assertion first caught).
		const home = GO.keys.find((k) => roleOf(GO, k.row) === "home" && k.hand === "l" && k.col === 1)!;
		const map = { id: "shared:test", name: "Shared", source: "test", rows: keymapById("qwerty").rows, byKey: { [home.id]: "\u00e9" } };
		expect(charFor(GO, keymapById("qwerty"), home)).toBe("a"); // what the grid alone would say
		expect(charFor(GO, map, home)).toBe("\u00e9");
		const r = resolve(GO, map);
		expect(r.byId.get(r.byChar.get("\u00e9")!)?.id).toBe(home.id);
		expect(r.byId.get(home.id)!.taught).toBe(true); // overriding a character does not un-teach the key
	});

	it("keeps a built-in keymap's routes on layer zero with bare stat ids", () => {
		const b = resolve(GO, keymapById("qwerty"));
		expect(b.routes.every((x) => x.layer === 0 && x.statId === x.keyId)).toBe(true);
		expect(b.routeChars.get(" ")!.keyId).toBe("R_T2"); // space still has a physical key to light
		for (const [ch, id] of b.byChar) expect(b.routeChars.get(ch)!.keyId, `char ${ch}`).toBe(id);
		for (const k of b.keys) expect(k.glyphs.length).toBeLessThanOrEqual(1);
	});
});

const layered = JSON.parse(readFileSync(new URL("./fixtures/go60-layers.json", import.meta.url), "utf8")) as KeycapFile & { layers: KeycapBinding[][] };

describe("resolving a layered keymap", () => {
	const { keymap } = keymapFromKeycap(layered, GO);
	const r = resolve(GO, keymap!);

	it("routes each character to the occurrence closest to home", () => {
		expect(r.routeChars.get("1")).toEqual({ char: "1", keyId: "L_C4R4", layer: 2, statId: "L_C4R4.2" }); // NavNum, below home
		expect(r.routeChars.get("7")!.layer).toBe(2); // Sym's F key types "&" (LS(N7)), so the NavNum 7 wins
		expect(r.routeChars.get("t")!.layer).toBe(0); // a taught letter beats every layer occurrence
		expect(r.byStat.get("L_C4R4.2")!.char).toBe("1");
		expect(r.byChar.get("1")).toBe("L_C4R4"); // and highlighting follows the route
	});

	it("names the layers and the keys that open them", () => {
		expect(r.layerNames).toEqual(["Main", "Sym", "NavNum", "Fn"]);
		expect(r.layerKeyOf.get(1)).toBe("R_T2");
		expect(r.layerKeyOf.get(2)).toBe("R_T1");
		expect(r.layerKeyOf.get(3)).toBe("L_T3");
	});

	it("draws every layer's character on its key", () => {
		const f = r.byId.get("R_C2R2")!; // f on Main, "&" on Sym
		expect(f.char).toBe("f");
		expect(f.glyphs).toEqual([{ char: "f", layer: 0 }, { char: "&", layer: 1 }]);
		const same = r.byId.get("R_T2")!; // its tap types Enter; a layer's SPACE adds no glyph
		expect(same.char).toBe("Enter"); // the file says so, not the shipped geometry's label
		expect(same.glyphs).toEqual([]);
	});

	it("routes the shifted symbols the file types", () => {
		expect(r.enterKey).toBe("R_T2"); // the "&lt 1 RET" thumb -- not R_T1, which the shipped geometry labels "Enter" but which taps Backspace here
		expect(r.routeChars.get("(")!.layer).toBe(1); // Sym's LS(N3) key -- "(" is now teachable
		expect(r.routeChars.get("(")!.char).toBe("(");
		expect(r.routeChars.get("\"")!.layer).toBe(1); // LS(SINGLE_QUOTE): the long alias is the same key
		expect(r.routeChars.get("q")!.layer).toBe(0); // the Fn layer's LG(Q) quits things; it must not teach q
		expect(r.routeChars.get("4")!.layer).not.toBe(3); // no longer the LC(LG(LS(N4))) shortcut: it rides the number row or NavNum's &hml LALT N4 tap
		expect(r.byId.get("L_C4R3")!.glyphs).toContainEqual({ char: "4", layer: 2 }); // hold for Alt, tap for 4: a real character on the r key
		expect(r.routeChars.get("7")!.char).toBe("7"); // digits keep their own routes, unchanged
	});
});
