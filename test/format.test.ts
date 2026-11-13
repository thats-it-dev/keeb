import { describe, expect, it } from "vitest";
import { formatPractised } from "../src/stats/format.ts";
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
