import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GEOMETRIES, allGeometries, forgetGeometry, geometryById, registerGeometry } from "../src/data/geometries.ts";
import { GO60 } from "../src/data/go60.ts";
import { geometryFromLayout, importId, importName } from "../src/layout/parse.ts";

const info = JSON.parse(readFileSync(new URL("./fixtures/go60-info.json", import.meta.url), "utf8")) as unknown;
const opts = { id: "go60-json", name: "Moergo Go60", source: "test/fixtures/go60-info.json" };

// The vendor's own info.json is where the shipped Go60 geometry came from, so reading it back out is
// the whole test: any position, column or rotation we get wrong shows up here.
function compare(label: string, json: unknown) {
	const { geometry, problems } = geometryFromLayout(json, opts);
	expect(problems, label).toEqual([]);
	const byId = new Map(geometry!.keys.map((k) => [k.id, k]));
	expect([...byId.keys()].sort()).toEqual(GO60.keys.map((k) => k.id).sort());
	const diffs = GO60.keys.flatMap((k) => {
		const m = byId.get(k.id)!;
		return (["hand", "row", "col", "x", "y", "w", "h", "rot"] as const)
			.filter((field) => m[field] !== k[field])
			.map((field) => `${label} ${k.id}.${field}: json=${String(m[field])} shipped=${String(k[field])}`);
	});
	expect(diffs, label).toEqual([]);
	return geometry!;
}

describe("importing a keyboard-layout json file", () => {
	it("rebuilds the shipped Go60 exactly", () => {
		const g = compare("go60", info);
		expect(g.rowRoles).toEqual(GO60.rowRoles);
		expect(g.split).toBe(true);
		expect(g.keys.length).toBe(60);
	});

	it("keeps vendor position names as ids and out of the legends", () => {
		const g = compare("labels", info);
		expect(g.keys.find((k) => k.id === "L_C5R2")?.label).toBe(""); // "L_C5R2" is a place, not a key
		expect(g.keys.find((k) => k.id === "L_C5R2")?.col).toBe(1);
	});

	it("scales units to integers, as atproto needs", () => {
		const g = compare("units", info);
		expect(g.keys.every((k) => Number.isInteger(k.x) && Number.isInteger(k.y) && Number.isInteger(k.rot))).toBe(true);
		expect(g.keys.find((k) => k.id === "L_C6R1")?.y).toBe(50); // 0.5u of column stagger
	});

	it("says what it could not read", () => {
		expect(geometryFromLayout({ hello: "world" }, opts).problems[0]).toMatch(/layouts/);
		expect(geometryFromLayout({ layouts: { LAYOUT: { layout: [] } } }, opts).problems[0]).toMatch(/empty/);
		expect(geometryFromLayout({ layouts: { LAYOUT: { layout: [{ label: "X", x: 0 }] } } }, opts).problems.join()).toMatch(/not a number/);
	});

	it("prefers a layout named LAYOUT and mentions the alternatives", () => {
		const two = { layouts: { OTHER: { layout: [] }, LAYOUT: { layout: [{ label: "A", row: 0, col: 0, x: 0, y: 0 }] } } };
		const { geometry, problems } = geometryFromLayout(two, opts);
		expect(geometry?.keys.map((k) => k.id)).toEqual(["A"]);
		expect(problems.join()).toContain("OTHER");
	});

	it("falls back to the middle gap when labels name no hand", () => {
		const plain = { layouts: { LAYOUT: { layout: [0, 1, 2, 3, 9, 10, 11, 12].map((i) => ({ row: 0, col: i, x: i, y: 0 })) } } };
		const { geometry } = geometryFromLayout(plain, opts);
		expect(geometry!.keys.filter((k) => k.hand === "l").map((k) => k.x)).toEqual([0, 100, 200, 300]); // x is in 1/100 key units
	});
});

describe("naming an imported board", () => {
	// Re-importing the same file replaces that board instead of adding a near-duplicate, so the id has
	// to come from the filename and be stable across paths and casing.
	it("derives a stable id from the file name", () => {
		expect(importId("go60-info.json")).toBe("import:go60-info");
		expect(importId("/home/moergo/config/Info.JSON")).toBe("import:info");
		expect(importId("corne v2!!")).toBe("import:corne-v2");
		expect(importId(".json")).toBe("import:board");
	});

	it("derives a readable name from the file name", () => {
		expect(importName("my_board.json")).toBe("my board");
		expect(importName(".json")).toBe("Imported board");
	});

	it("registers an imported board next to the shipped ones without disturbing them", () => {
		const { geometry } = geometryFromLayout(info, { id: importId("go60-info.json"), name: importName("go60-info.json"), source: "go60-info.json" });
		const before = GEOMETRIES.length;
		expect(registerGeometry(geometry!)).toBe(true);
		expect(registerGeometry(geometry!)).toBe(false); // the same id twice would silently swap it
		expect(allGeometries().length).toBe(before + 1);
		expect(geometryById("import:go60-info").keys.length).toBe(60);
		forgetGeometry("import:go60-info");
		expect(allGeometries().length).toBe(before);
		expect(geometryById("import:go60-info").id).toBe(GEOMETRIES[0].id); // an unknown id falls back
	});
});
