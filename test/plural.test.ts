import { describe, expect, it } from "vitest";
import { plural } from "../src/plural.js";

describe("plural", () => {
	it("returns singular when n is 1", () => {
		expect(plural(1, "session", "sessions")).toBe("session");
		expect(plural(1, "day", "days")).toBe("day");
	});

	it("returns plural when n is not 1", () => {
		expect(plural(3, "session", "sessions")).toBe("sessions");
		expect(plural(0, "day", "days")).toBe("days");
		expect(plural(2, "day", "days")).toBe("days");
	});
});
