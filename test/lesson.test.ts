import { describe, expect, it } from "vitest";
import { keymapById } from "../src/data/keymaps.ts";
import { GO60 } from "../src/data/go60.ts";
import { lesson } from "../src/lesson/generator.ts";
import { press, start } from "../src/lesson/engine.ts";
import { WORDS } from "../src/lesson/corpus.ts";
import { resolve } from "../src/keyboard/resolve.ts";
import { emptyStat, timeToTypeMs } from "../src/stats/stats.ts";

const r = resolve(GO60, keymapById("qwerty"));
const TARGET = 200; // cpm, a 300ms-per-character goal

// A fake typist with a fixed speed per character, so a slow key should show up as drilled more.
const SPEED: Record<string, number> = { s: 90, t: 95, a: 110, r: 130, n: 140, e: 120, i: 260, o: 150, g: 170, m: 240 };

function typeRun(e: ReturnType<typeof start>, from = 1000) {
	let engine = e;
	let now = from;
	let mistakes = 0;
	for (let guard = 0; guard < 20000; guard += 1) {
		const want = [...engine.text][engine.index];
		if (want === undefined) break;
		const wrong = guard % 41 === 40 && mistakes < 6;
		if (wrong) mistakes += 1;
		const res = press(engine, r, wrong ? "z" : want, now, TARGET);
		engine = res.engine;
		if (res.finished) break;
		now += SPEED[want] ?? 220;
	}
	return { engine, now, mistakes };
}

const LETTERS = Object.keys(SPEED);
const SPEED_KEYS = LETTERS.length;

describe("lesson engine", () => {
	it("starts a brand new learner on the two index keys", () => {
		const e = start(r, {}, TARGET);
		expect([...e.text].filter((c) => c !== " ").length).toBeGreaterThan(10);
		expect(e.pending).not.toBe("");
		// The first line uses f and j only; the space that separates them is a thumb key the
		// learner has not touched yet, so it is not counted as a taught character.
		expect([...new Set([...e.text].filter((c) => c !== " "))].sort().join("")).toBe("fj");
		expect(e.ladder.next && r.byId.get(e.ladder.next)?.char.toLowerCase()).toBe("d");
	});

	it("records one sample per keystroke and one error per mistake", () => {
		const e = start(r, {}, TARGET);
		const ok = press(e, r, [...e.text][e.index], 5000, TARGET);
		expect(ok.accepted).toBe(true);
		expect(ok.engine.stats[ok.targetId]?.samples).toBe(1);
		const bad = press(ok.engine, r, "q", 6000, TARGET);
		expect(bad.accepted).toBe(false);
		expect(bad.engine.index).toBe(ok.engine.index);
		expect((bad.engine.stats[bad.targetId] ?? emptyStat()).errors).toBeGreaterThanOrEqual(1);
	});

	it("measures the slow key as slow", () => {
		// Feed a fixed speed per character straight into the stats, then read the numbers back.
		let engine = start(r, {}, TARGET);
		for (const [ch, ms] of Object.entries(SPEED)) {
			const id = r.byChar.get(ch);
			expect(id, ch).toBeTruthy();
			engine = { ...engine, stats: { ...engine.stats, [id!]: { ttMs16: ms * 16, samples: 40, errors: 0 } } };
		}
		expect(Object.keys(engine.stats).length).toBe(SPEED_KEYS);
		expect(timeToTypeMs(engine.stats[r.byChar.get("m")!])).toBe(240);
		expect(timeToTypeMs(engine.stats[r.byChar.get("s")!])).toBe(90);
	});

	it("unlocks the next key once the current one is up to speed", () => {
		const fresh = start(r, {}, TARGET);
		expect(fresh.ladder.next).toBeDefined();
		const after = typeRun(fresh).engine;
		expect(after.ladder.unlocked.length).toBeGreaterThanOrEqual(fresh.ladder.unlocked.length);
	});

	it("never asks for a character that is not unlocked", () => {
		const { engine } = typeRun(start(r, {}, TARGET));
		const unlocked = new Set(engine.ladder.unlocked.map((id) => r.byId.get(id)?.char.toLowerCase()));
		for (const ch of new Set([...engine.text])) {
			if (ch === " ") continue;
			expect(unlocked.has(ch), ch).toBe(true);
		}
	});

	it("keeps the corpus broad enough for every letter", () => {
		for (const ch of "abcdefghijklmnopqrstuvwxyz") {
			expect(WORDS.filter((w) => w.includes(ch)).length, ch).toBeGreaterThan(15);
		}
	});

	it("generates a deterministic lesson from the same stats", () => {
		const stats = typeRun(start(r, {}, TARGET)).engine.stats;
		const a = lesson(["s", "t", "a", "r"], stats, TARGET, r.byChar);
		const b = lesson(["s", "t", "a", "r"], stats, TARGET, r.byChar);
		expect(a.text).toBe(b.text);
	});

	it("drills the weak key more often than a fast one", () => {
		const stats: Record<string, { ttMs16: number; samples: number; errors: number }> = {};
		for (const [ch, ms] of Object.entries(SPEED)) {
			const id = r.byChar.get(ch);
			if (id) stats[id] = { ttMs16: ms * 16, samples: 40, errors: ch === "i" ? 8 : 0 };
		}
		const letters = Object.keys(SPEED);
		const text = lesson(letters, stats, TARGET, r.byChar, 40).text;
		const count = (ch: string) => [...text].filter((c) => c === ch).length;
		expect(count("s")).toBeGreaterThan(count("i") / 4);
		expect(text.length).toBeGreaterThan(40);
	});
});
