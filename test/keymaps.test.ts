import { describe, expect, it } from "vitest";
import { KEYMAPS, keymapById } from "../src/data/keymaps.ts";
import type { KeymapRow } from "../src/keyboard/types.ts";

const letters = (row: KeymapRow) => row.filter((c) => /^[a-z]$/.test(c)) as string[];

describe("keymaps", () => {
	it.each(KEYMAPS)("$name places all 26 letters once", (m) => {
		const seen: string[] = [];
		for (const role of ["upper", "home", "lower"] as const) {
			const r = m.rows[role];
			expect(r).toBeDefined();
			expect(r!.l).toHaveLength(6);
			expect(r!.r).toHaveLength(6);
			seen.push(...letters(r!.l), ...letters(r!.r));
		}
		expect([...new Set(seen)].sort().join("")).toBe("abcdefghijklmnopqrstuvwxyz");
	});

	it("QWERTY home row is the one everyone learns first", () => {
		const q = keymapById("qwerty").rows.home!;
		expect(q.l.slice(1)).toEqual(["a", "s", "d", "f", "g"]);
		expect(q.r.slice(1).reverse()).toEqual(["h", "j", "k", "l", ";"]);
	});

	it("Colemak-DH keeps the index fingers on t/n and curls them to d/h", () => {
		const m = keymapById("colemak-dh").rows;
		expect(m.home!.l[5]).toBe("g");
		expect(m.home!.l[4]).toBe("t");
		expect(m.home!.r[4]).toBe("n");
		expect(m.lower!.l[5]).toBe("d");
		expect(m.lower!.r[5]).toBe("h");
	});

	it("Workman puts h on the left index home key", () => {
		const m = keymapById("workman").rows.home!;
		expect(m.l.slice(1)).toEqual(["a", "s", "h", "t", "g"]);
	});

	it("Dvorak lines the left home row with vowels", () => {
		const m = keymapById("dvorak").rows.home!;
		expect(m.l.slice(1)).toEqual(["a", "o", "e", "u", "i"]);
		expect(m.r.slice(1).reverse()).toEqual(["d", "h", "t", "n", "s"]);
	});

	it("Norman moves p under the right index finger", () => {
		expect(keymapById("norman").rows.lower!.r[5]).toBe("p");
	});
});
