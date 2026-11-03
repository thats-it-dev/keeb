import { describe, expect, it } from "vitest";
import { keymapById } from "../src/data/keymaps.ts";
import { GO60 } from "../src/data/go60.ts";
import { lesson } from "../src/lesson/generator.ts";
import { resolve } from "../src/keyboard/resolve.ts";

const r = resolve(GO60, keymapById("qwerty"));
const LETTERS = "fjdkslaretuiognm".split("");

function practised(ms: number, samples = 30) {
	const stats: Record<string, { ttMs16: number; samples: number; errors: number }> = {};
	for (const ch of LETTERS) stats[r.byChar.get(ch)!] = { ttMs16: ms * 16, samples, errors: 0 };
	return stats;
}

describe("lesson generator", () => {
	it("makes real words once the home row is unlocked", () => {
		const text = lesson(["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"], practised(180), 200, r.byChar, 8).text;
		const words = text.split(" ").filter((w) => w.length > 1);
		expect(words.length).toBeGreaterThan(3);
		expect(words.join(" ")).toMatch(/(as|ad|ask|lad|sal|gas|had|hall)/);
	});

	it("pools enough words per stage to avoid repeating itself", () => {
		const letters = ["f", "j", "d", "k", "s", "l", "a", "r", "e", "t", "n", "i", "o", "m"];
		const text = lesson(letters, practised(150), 200, r.byChar, 20).text;
		expect(new Set(text.split(" ")).size).toBeGreaterThan(8);
	});

	it("leans on the key with errors", () => {
		const letters = ["s", "t", "a", "r", "n", "e", "i", "o"];
		const stats = practised(150);
		for (let i = 0; i < 10; i += 1) stats[r.byChar.get("s")!] = { ttMs16: 400 * 16, samples: 10, errors: 6 };
		const text = lesson(letters, stats, 200, r.byChar, 30).text;
		const share = [...text].filter((c) => c === "s").length / [...text].filter((c) => c !== " ").length;
		expect(share).toBeGreaterThan(0.08);
	});
});
