import { describe, expect, it } from "vitest";
import { formatPractised } from "../src/stats/format.ts";

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
