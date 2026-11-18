import { describe, expect, it } from "vitest";
import { describeRoute, formatPractised } from "../src/stats/format.ts";
import { formatThousands } from "../src/stats/format.ts";

describe("formatPractised", () => {
	it("formats 0 as '0 min'", () => {
		expect(formatPractised(0)).toBe("0 min");
	});

	it("formats 45 as '45 min'", () => {
		expect(formatPractised(45)).toBe("45 min");
	});

	it("formats 59 as '59 min'", () => {
		expect(formatPractised(59)).toBe("59 min");
	});

	it("formats 60 as '1 h'", () => {
		expect(formatPractised(60)).toBe("1 h");
	});

	it("formats 65 as '1 h 5 min'", () => {
		expect(formatPractised(65)).toBe("1 h 5 min");
	});

	it("formats 734 as '12 h 14 min'", () => {
		expect(formatPractised(734)).toBe("12 h 14 min");
	});
});

describe("formatThousands", () => {
	it("formats 123456 correctly", () => {
		expect(formatThousands(123456)).toBe("123,456");
	});

	it("formats single digits unchanged", () => {
		expect(formatThousands(5)).toBe("5");
	});

	it("formats thousands with one comma", () => {
		expect(formatThousands(1000)).toBe("1,000");
	});

	it("formats millions", () => {
		expect(formatThousands(1234567890)).toBe("1,234,567,890");
	});

	it("formats zero", () => {
		expect(formatThousands(0)).toBe("0");
	});

	it("rounds fractional input", () => {
		expect(formatThousands(1.5)).toBe("2");
		expect(formatThousands(1.6)).toBe("2");
		expect(formatThousands(1234.4)).toBe("1,234");
		expect(formatThousands(1234.6)).toBe("1,235");
	});

	it("formats negative input", () => {
		expect(formatThousands(-1234)).toBe("-1,234");
		expect(formatThousands(-99)).toBe("-99");
		expect(formatThousands(-1_000_000)).toBe("-1,000,000");
	});
});

describe("describeRoute", () => {
	const charOf = (s: string) => ({ "L_C5R3": "t", "L_C4R4.2": "1", "R_C2R2.1": "7" })[s] ?? s;
	const layerName = (l: number) => ({ 1: "Sym", 2: "NavNum" })[l] ?? "";

	it("names a base route by its character", () => {
		expect(describeRoute("L_C5R3", charOf, layerName)).toBe("T");
	});

	it("names a layer route by character and layer", () => {
		expect(describeRoute("L_C4R4.2", charOf, layerName)).toBe("1 · NavNum");
		expect(describeRoute("R_C2R2.1", charOf, layerName)).toBe("7 · Sym");
	});

	it("falls back honestly", () => {
		expect(describeRoute("zz", charOf, layerName)).toBe("zz"); // no route to look up: show the raw id
		expect(describeRoute("X.9", (s) => (s === "X.9" ? "q" : s), () => "")).toBe("Q · layer 9"); // a layer number the file never named
	});
});
