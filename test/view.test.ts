import { describe, expect, it } from "vitest";
import { charForLayer } from "../src/keyboard/layer.ts";
import type { Resolved } from "../src/keyboard/resolve.ts";

describe("charForLayer", () => {
	const baseKeys = [
		{ char: "a" },
		{ char: "b" },
		{ char: "" },
		{ char: "d" },
	];

	const makeResolved = (layers?: string[][]): Resolved => ({
		keys: baseKeys as any,
		layers,
	} as any);

	it("returns base char when layers is undefined", () => {
		expect(charForLayer(makeResolved(), 0, 0)).toBe("a");
	});

	it("returns base char when layer index is out of bounds", () => {
		const resolved = makeResolved([["x", "y"]]);
		expect(charForLayer(resolved, 0, 5)).toBe("a");
	});

	it("returns layer char when slot is non-empty", () => {
		const resolved = makeResolved([["x", "y", "z", "w"]]);
		expect(charForLayer(resolved, 0, 0)).toBe("x");
		expect(charForLayer(resolved, 2, 0)).toBe("z");
	});

	it("falls back to base char when layer slot is empty", () => {
		const resolved = makeResolved([["", "", "z", "w"]]);
		expect(charForLayer(resolved, 0, 0)).toBe("a");
		expect(charForLayer(resolved, 1, 0)).toBe("b");
		expect(charForLayer(resolved, 2, 0)).toBe("z");
	});

	it("supports multiple layers", () => {
		const resolved = makeResolved([
			["x", "y", "z", "w"],
			["a", "b", "", "d"],
		]);
		expect(charForLayer(resolved, 2, 0)).toBe("z");
		expect(charForLayer(resolved, 2, 1)).toBe("");
	});

	it("falls back to base char when layer array is shorter than keys array", () => {
		const resolved = makeResolved([["x", "y"]]);
		// layer 0 has only 2 elements; keys has 4
		expect(charForLayer(resolved, 0, 0)).toBe("x");
		expect(charForLayer(resolved, 1, 0)).toBe("y");
		expect(charForLayer(resolved, 2, 0)).toBe(""); // base char is ""
		expect(charForLayer(resolved, 3, 0)).toBe("d"); // key index out of layer bounds
	});
});
