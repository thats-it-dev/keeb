import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORNE } from "../src/data/corne.ts";
import { GO60 } from "../src/data/go60.ts";
import { charOfBinding, isKeycapFile, keymapFromKeycap } from "../src/layout/keycap.ts";
import type { KeycapBinding, KeycapFile } from "../src/layout/keycap.ts";

type Fixture = KeycapFile & { layers: KeycapBinding[][] };
const file = JSON.parse(readFileSync(new URL("./fixtures/go60-keycap.json", import.meta.url), "utf8")) as Fixture;

// 6-layer fixture from the real Go60 Gallium layout
const big = JSON.parse(readFileSync(new URL("./fixtures/go60-36.json", import.meta.url), "utf8")) as Fixture;
const kp = (v: string): KeycapBinding => ({ value: "&kp", params: [{ value: v }] });

describe("recognising a layout editor export", () => {
	it("tells the two json formats apart", () => {
		expect(isKeycapFile(file)).toBe(true);
		const kle = JSON.parse(readFileSync(new URL("./fixtures/go60-info.json", import.meta.url), "utf8")) as unknown;
		expect(isKeycapFile(kle)).toBe(false);
		expect(isKeycapFile({ hello: "world" })).toBe(false);
	});

	it("refuses a file for a different board", () => {
		const { keymap, problems } = keymapFromKeycap({ ...file, keyboard: "glove80" }, GO60);
		expect(keymap).toBeUndefined();
		expect(problems[0]).toMatch(/glove80/);
	});

	it("refuses a file whose binding count is not the board's", () => {
		const { keymap, problems } = keymapFromKeycap({ ...file, keyboard: "corne" }, CORNE);
		expect(keymap).toBeUndefined();
		expect(problems.join()).toMatch(/bindings but/);
	});

	it("refuses a file whose matrix order does not match the board", () => {
		// Reversed, the number row lands among the thumbs; the unmapped keys notice and say so.
		const reversed: Fixture = { ...file, layers: [[...file.layers[0]].reverse(), ...file.layers.slice(1)] };
		const { keymap, problems } = keymapFromKeycap(reversed, GO60);
		expect(keymap).toBeUndefined();
		expect(problems.join()).toMatch(/binding order/);
	});
});

describe("reading characters out of a layout editor export", () => {
	const { keymap, geometryId, layerNames, problems } = keymapFromKeycap(file, GO60);

	it("uses the board the file names, and keeps every layer visible", () => {
		expect(problems).toEqual([]);
		expect(geometryId).toBe("go60");
		expect(layerNames).toEqual(["Main", "SymNav", "mouse", "Magic"]);
	});

	it("puts the upper row where the fingers are", () => {
		// The vendor's matrix order is left outer to inner, then right inner to outer.
		expect(keymap!.rows.upper?.l).toEqual(["Tab", "b", "l", "d", "c", "v"]);
		expect(keymap!.rows.upper?.r).toEqual([" ", ",", "u", "o", "f", "j"]);
	});

	it("puts the home row where the fingers are", () => {
		expect(keymap!.rows.home?.l).toEqual(["", "n", "r", "t", "s", "g"]);
		expect(keymap!.rows.home?.r).toEqual(["Enter", "i", "e", "a", "h", "y"]);
	});

	it("puts the lower row where the fingers are", () => {
		expect(keymap!.rows.lower?.l).toEqual(["", "x", "q", "m", "w", "z"]);
		expect(keymap!.rows.lower?.r).toEqual(["=", ".", ";", "'", "p", "k"]);
	});

	it("keeps a real character on the outer column", () => {
		// The shipped keymaps leave column 0 blank so the geometry label shows, but when the file
		// genuinely types something there we show that instead. It stays outside the taught set.
		expect(keymap!.rows.lower?.r[0]).toBe("=");
		expect(keymap!.rows.home?.l[0]).toBe(""); // LCTRL types no character
	});

	it("leaves keys that type nothing alone", () => {
		// The outer column holds TAB, LCTRL and a layer key here: none of them are characters.
		expect(keymap!.rows.home?.l[0]).toBe("");
		expect(keymap!.rows.lower?.l[0]).toBe("");
	});
});

describe("character of a single binding", () => {
	it("reads a plain key press", () => {
		expect(charOfBinding(kp("A"))).toBe("a");
		expect(charOfBinding(kp("SEMI"))).toBe(";");
		expect(charOfBinding(kp("MINUS"))).toBe("-");
	});

	it("unwraps a shifted or chorded keycode to the key underneath", () => {
		expect(charOfBinding({ value: "&kp", params: [{ value: "LS", params: [{ value: "MINUS" }] }] })).toBe("-");
		expect(charOfBinding({ value: "&kp", params: [{ value: "LC", params: [{ value: "Y" }] }] })).toBe("y");
	});

	it("takes the tap half of a hold-tap", () => {
		expect(charOfBinding({ value: "&mt", params: [{ value: "ESC" }, { value: "GRAVE" }] })).toBe("`");
	});

	it("understands a Custom binding's raw text", () => {
		expect(charOfBinding({ value: "Custom", params: [{ value: "&kp N5" }] })).toBe("5");
		expect(charOfBinding({ value: "Custom", params: [{ value: "&lt 1 LC(UP)" }] })).toBe("UP"); // &lt with trailing key is a character key
	});

	it("gives up on keys that type nothing", () => {
		expect(charOfBinding({ value: "&trans" })).toBeUndefined();
		expect(charOfBinding({ value: "&none" })).toBeUndefined();
		expect(charOfBinding({ value: "&mo", params: [{ value: "2" }] })).toBeUndefined();
		expect(charOfBinding({ value: "&mkp", params: [{ value: "LCLK" }] })).toBeUndefined();
		expect(charOfBinding({ value: "&workspace_left" })).toBeUndefined(); // a macro, referred to by name
	});
});

describe("6-layer Go60 (go60-36.json)", () => {

	it("imports every layer", () => {
		const { keymap, layerNames, problems } = keymapFromKeycap(big, GO60);
		expect(problems).toEqual([]);
		expect(keymap!.layers).toHaveLength(6);
		expect(layerNames).toEqual(["Main", "Sym", "NavNum", "Fn", "mouse", "Magic"]);
	});

	it("detects layer-switch keys", () => {
		const { keymap } = keymapFromKeycap(big, GO60);
		// &lt/&mo with trailing keys are character keys, &trans is excluded.
		// go60-36 has no pure (no-trailing-key) &lt/&mo, so no layer switches from keycap.
		const keys = keymap!.layerKeys!.filter((k) => k.toLayer > 0);
		expect(keys).toEqual([]);
	});

	it("detects &mo (momentary) layer keys", () => {
		const binding = { value: "Custom", params: [{ value: "&mo 1 X" }] };
		const result = charOfBinding(binding);
		expect(result).toBeUndefined();
	});

	it("detects &lt 1 LC(UP) as a character key", () => {
		const binding = { value: "Custom", params: [{ value: "&lt 1 LC(UP)" }] };
		const result = charOfBinding(binding);
		expect(result).toBe("UP");
	});

	it("builds byKey for non-taught keys from layer-0 characters", () => {
		const { keymap, problems } = keymapFromKeycap(big, GO60);
		expect(problems).toEqual([]);
		expect(keymap!.byKey).toBeDefined();
		// Number row keys should be in byKey
		expect(Object.keys(keymap!.byKey!)).toContain("L_C5R1"); // first number key
	});

	it("does not register &trans as layer keys", () => {
		const { keymap } = keymapFromKeycap(big, GO60);
		// &trans is a pass-through, not a layer switch.
		const trans = keymap!.layerKeys!.filter((k) => k.toLayer === 0);
		expect(trans.length).toBe(0);
	});

	it("pads layerNames when the fixture has fewer names than layers", () => {
		const short = { ...big, layer_names: ["Main", "Sym"] } as KeycapFile & { layers: KeycapBinding[][] };
		const { layerNames } = keymapFromKeycap(short, GO60);
		expect(layerNames).toEqual(["Main", "Sym", "Layer 2", "Layer 3", "Layer 4", "Layer 5"]);
	});
});

describe("advanced layer key patterns", () => {
	it("detects &lt 1 LC(UP) as a character key", () => {
		// &lt with trailing key is a character key — the tap sends the trailing key.
		const binding = { value: "Custom", params: [{ value: "&lt 1 LC(UP)" }] };
		expect(charOfBinding(binding)).toBe("UP");
	});

	it("maps &mo 1 to correct layer key properties", () => {
		// Create a temporary fixture with &mo
		const moFixture = {
			...big,
			layers: [
				[...big.layers[0]],
				[...big.layers[1]],
			],
		} as KeycapFile & { layers: KeycapBinding[][] };
		// Replace the first key in layer 0 with &mo 1
		moFixture.layers[0][0] = { value: "Custom", params: [{ value: "&mo 1 X" }] };
		const { keymap } = keymapFromKeycap(moFixture, GO60);
		// Filter by action + keyId to distinguish from &lt entries to the same layer.
		const moKeys = keymap!.layerKeys!.filter((k) => k.action === "hold" && k.keyId === "L_C6R1");
		expect(moKeys).toHaveLength(1);
		expect(moKeys[0].toLayer).toBe(1);
	});
});
