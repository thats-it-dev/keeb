import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORNE } from "../src/data/corne.ts";
import { GO60 } from "../src/data/go60.ts";
import { charOfBinding, isKeycapFile, keymapFromKeycap } from "../src/layout/keycap.ts";
import type { KeycapBinding, KeycapFile } from "../src/layout/keycap.ts";

type Fixture = KeycapFile & { layers: KeycapBinding[][] };
const file = JSON.parse(readFileSync(new URL("./fixtures/go60-keycap.json", import.meta.url), "utf8")) as Fixture;
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
		expect(keymap!.rows.upper?.l).toEqual(["", "b", "l", "d", "c", "v"]);
		expect(keymap!.rows.upper?.r).toEqual(["", ",", "u", "o", "f", "j"]);
	});

	it("puts the home row where the fingers are", () => {
		expect(keymap!.rows.home?.l).toEqual(["", "n", "r", "t", "s", "g"]);
		expect(keymap!.rows.home?.r).toEqual(["", "i", "e", "a", "h", "y"]);
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
		expect(charOfBinding({ value: "Custom", params: [{ value: "&lt 1 LC(UP)" }] })).toBeUndefined();
	});

	it("gives up on keys that type nothing", () => {
		expect(charOfBinding({ value: "&trans" })).toBeUndefined();
		expect(charOfBinding({ value: "&none" })).toBeUndefined();
		expect(charOfBinding({ value: "&mo", params: [{ value: "2" }] })).toBeUndefined();
		expect(charOfBinding({ value: "&mkp", params: [{ value: "LCLK" }] })).toBeUndefined();
		expect(charOfBinding({ value: "&workspace_left" })).toBeUndefined(); // a macro, referred to by name
	});
});
