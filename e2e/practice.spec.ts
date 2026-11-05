// M2: the practice loop. Real words from the first line, the next key highlighted on the board,
// and the key set growing as the slow keys speed up.
import type { Page } from "@playwright/test";
import { loadConfig } from "../vite/config.ts";
import { expect, test } from "./csp.ts";
import { keyName } from "./keys.ts";

const cfg = loadConfig();
const heading = cfg.heading ?? cfg.title; // the h1 shows the heading; the tab shows the title

const line = (page: Page) => page.locator("tt-practice .line");
const key = (page: Page, id: string) => page.locator(`tt-keyboard g[data-id="${id}"]`);

// Wait for IndexedDB to answer, or the practice pane has no lesson yet.
const ready = async (page: Page) => {
	await expect(line(page)).toBeVisible();
	await expect(page.locator("h1")).toHaveText(heading);
	// The kit's faces are font-display: swap, so glyphs reflow when they land. A test that measures
	// text twice must not straddle that swap.
	await page.evaluate(() => document.fonts.ready);
};

const wanted = async (page: Page): Promise<string> => {
	const text = (await line(page).getAttribute("data-text")) ?? "";
	const cursor = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);
	return [...text][cursor] ?? "";
};

const tap = (page: Page, ch: string) => page.locator("tt-practice").press(keyName(ch));

const keysTyped = (page: Page) => page.evaluate(() => Object.keys((document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { stats: object } }).engine.stats).length);

// Which key a character lives on, read from the resolved board rather than from app-main's highlight
// state: a test that asks the highlight where the highlight is will always agree with it.
const idFor = (page: Page, ch: string) =>
	page.evaluate(
		(c) => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { resolved: { byChar: Map<string, string> } }).resolved.byChar.get(c) ?? "",
		ch,
	);

const cursorOf = (page: Page) =>
	page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);

// Keys the persisted record actually holds. Reading the store rather than the component is the point: the
// write behind a keystroke is async, and reload() would cut it off mid-transaction -- which is why this
// test flaked in CI on a slow runner while passing locally.
const storedKeys = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<number>((res, rej) => {
				const open = indexedDB.open("keeb");
				open.onsuccess = () => {
					const r = open.result.transaction("stats").objectStore("stats").getAll();
					r.onsuccess = () => {
						const rows = (r.result ?? []) as { value?: Record<string, unknown> }[];
						open.result.close();
						res(rows.reduce((n, row) => n + Object.keys(row.value ?? {}).length, 0));
					};
					r.onerror = () => rej(r.error);
				};
				open.onerror = () => rej(open.error);
			}),
	);

test("the first line is already real words", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const text = (await line(page).getAttribute("data-text")) ?? "";
	const words = text.split(" ");
	expect(words.length).toBeGreaterThan(6);
	expect(words.filter((w) => w.length > 2).length).toBeGreaterThan(3);
});

test("the lesson is text, not a field you type into", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await expect(page.locator("tt-practice input, tt-practice textarea, tt-practice [contenteditable]")).toHaveCount(0);
	await tap(page, await wanted(page));
	await expect(page.locator("tt-practice .now")).toBeVisible(); // one underlined letter marks the target
	const marks = await page.evaluate(() => {
		const pr = document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { shadowRoot: ShadowRoot };
		return [...pr.shadowRoot.querySelectorAll(".line span")].map((s) => ({ cls: s.className, dec: getComputedStyle(s).textDecorationLine, color: getComputedStyle(s).color }));
	});
	const now = marks.find((m) => m.cls === "now");
	expect(now?.dec).toBe("underline");
	// The target carries the colour of a letter you have not reached yet. Colour reports what happened --
	// dark means hit, red means missed -- and the underline alone reports where you are. Give the target a
	// colour of its own and it sits one step ahead of your typing again.
	expect(now?.color).toBe(marks.find((m) => m.cls === "todo")?.color);
	expect(now?.color).not.toBe(marks.find((m) => m.cls === "hit")?.color);
	// A mistyped character turns red and stays red, even under the cursor.
	const ch = await wanted(page);
	await tap(page, ch === "z" ? "y" : "z");
	await expect(page.locator("tt-practice .bad")).toBeVisible();
});

test("stats sit above the line, settings start hidden", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const boxes = await page.evaluate(() => {
		const root = document.querySelector("app-main")!.shadowRoot!;
		const read = root.querySelector(".read")!.getBoundingClientRect();
		const line = root.querySelector("tt-practice")!.shadowRoot.querySelector(".line")!.getBoundingClientRect();
		return { readBottom: read.bottom, lineTop: line.top };
	});
	expect(boxes.readBottom).toBeLessThanOrEqual(boxes.lineTop); // metrics above the phrase
	await expect(page.locator("dialog")).toBeHidden(); // board/keymap behind the settings modal
	await page.locator("app-main .head button[aria-label='Settings']").click();
	await expect(page.locator("dialog")).toBeVisible();
	await expect(page.locator("dialog .panel")).toBeVisible();
	await page.locator("dialog [aria-label='Close settings']").click();
	await expect(page.locator("dialog")).toBeHidden();
});

const geometry = (page: Page) =>
	page.evaluate(() => {
		const line = document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice")!.shadowRoot!.querySelector(".line")!;
		const r = line.getBoundingClientRect();
		const last = line.lastElementChild!.getBoundingClientRect();
		// Measured against the line's own left edge, so a scroll between the two samples cannot be read
		// as a layout shift.
		return { width: Math.round(r.width), end: Math.round(last.x + last.width - r.left), text: line.dataset.text };
	});

// The cursor plate must be painted out of flow. A padded span made the current letter wider than
// every other copy of it, so the whole line slid sideways on each keystroke.
test("letters stay in the same place as the cursor moves", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const before = await geometry(page);
	for (let i = 0; i < 8; i += 1) await tap(page, await wanted(page));
	const after = await geometry(page);
	expect(after.text).toBe(before.text); // the same line, so the two samples are comparable
	expect({ width: after.width, end: after.end }).toEqual({ width: before.width, end: before.end });
});

test("types a whole line and reports a plausible speed", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	for (let i = 0; i < 40; i += 1) {
		const ch = await wanted(page);
		if (ch === "") break;
		await tap(page, ch);
	}
	await expect(page.locator("main")).toContainText("wpm");
	const cursor = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);
	expect(cursor).toBeGreaterThan(10);
});

test("progress screen ranks keys instead of saturating every bar", async ({ page }, testInfo) => {
	await page.goto("/");
	await ready(page);
	for (let i = 0; i < 40; i += 1) {
		const ch = await wanted(page);
		if (ch === "") break;
		// Deliberate pauses, so some keys end up measurably slower than others. A run of uniform synthetic
		// taps types every key at the same speed, which would make "different times give different widths"
		// vacuous and let a scale that cannot rank anything pass.
		if (i % 5 === 4) await page.waitForTimeout(60);
		await tap(page, ch);
	}
	await page.locator("button", { hasText: "Progress" }).click();
	const rows = page.locator(".krow");
	expect(await rows.count()).toBeGreaterThan(3);
	// Only keys with timing get a row. A key never struck has no bar to draw, and 40 empty rows used to
	// bury the handful that meant something; they get chips instead.
	expect(await page.locator(".chip").count()).toBeGreaterThan(0);
	const nums = await page.locator(".krow .num").allInnerTexts();
	expect(nums.every((n) => /wpm/.test(n))).toBe(true);
	// No row may render without a name. The space bar's character is a blank, so it used to arrive as an
	// invisible label on the most-struck key on the board.
	const caps = await page.locator(".krow .cap").allInnerTexts();
	expect(caps.length).toBeGreaterThan(3);
	expect(caps.every((c) => c.trim() !== "")).toBe(true);
	expect(caps).toContain("space");
	const widths = await page.locator(".krow .bar").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.width));
	expect(widths.every((w) => parseFloat(w) <= 100 && parseFloat(w) >= 2)).toBe(true);
	// The regression this screen was missing: bars scaled against the goal pinned anything faster than 2x
	// goal at 100% and the chart ranked nothing. Different times must give different widths.
	const times = await page.locator(".krow .num").allInnerTexts();
	const msOf = (t: string) => Number(t.match(/(\d+)ms/)?.[1] ?? -1);
	const pairs = widths.map((w, i) => ({ ms: msOf(times[i]!), w: parseFloat(w) })).filter((p) => p.ms > 0);
	const distinct = [...new Set(pairs.map((p) => p.ms))];
	expect(distinct.length).toBeGreaterThan(1);
	for (const a of pairs) for (const b of pairs) if (a.ms < b.ms) expect(a.w).toBeGreaterThanOrEqual(b.w);
	// The strict version, and the one that actually catches the old scale: different times must produce
	// different bars, not merely non-inverted ones. The goal-relative formula clamped anything faster than
	// 2x goal to 100%, so a fast run gave one uniform set of widths.
	//
	// The scale is logarithmic, so "can the bars differ at all" is a question about RATIO: measured against
	// barWidth(), one width point costs 2^(1/25) - 1 = 2.81% of ms, at every goal speed. Two points of spread
	// is the smallest difference this screen could possibly draw, and below that the browser is not testing
	// the scale -- it is testing how precisely the runner timestamps synthetic keystrokes. When the spread is
	// that narrow the check is annotated rather than silently dropped, and test/scale.test.ts is what holds
	// the ranking property in that case.
	const ratio = Math.max(...pairs.map((p) => p.ms)) / Math.min(...pairs.map((p) => p.ms));
	if (ratio >= Math.pow(2, 2 / 25)) {
		expect(new Set(pairs.map((p) => p.w)).size).toBeGreaterThan(1);
	} else {
		testInfo.annotations.push({ type: "note", description: `keystroke spread was ${(ratio.toFixed(4))}x, below the scale's 5.7% resolution; ranking asserted in test/scale.test.ts` });
	}
	// The tick is the goal, so it belongs at the same x in every row: the scale's midpoint.
	const marks = await page.locator(".krow .mark").evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).style.left))]);
	expect(marks).toEqual(["50%"]);
	await expect(page.locator(".card").first()).toContainText("wpm");
});

test("switching keyboards cannot write the old layout's stats into the new layout's record", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	for (let i = 0; i < 6; i += 1) await tap(page, await wanted(page));
	const engineKeys = () => page.evaluate(() => Object.keys((document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { stats: object } }).engine.stats));
	const before = await engineKeys();
	expect(before.length).toBeGreaterThan(0);
	await page.locator("button[aria-label='Settings']").click();
	await page.locator("select").first().selectOption("corne");
	await ready(page);
	// Switching layouts must not leave the child lesson holding the previous board's numbers: #flushStats
	// writes whatever the engine holds under whichever layout is selected. What makes this safe is that
	// `ready` is false for the whole load, which unmounts <tt-practice> so no keystroke can land in between.
	expect((await engineKeys()).length).toBe(0);
	// And typing on the new board must not resurrect a single key from the old one.
	await tap(page, await wanted(page));
	expect((await engineKeys()).length).toBeLessThanOrEqual(1);
});

test("highlights the key the next character lives on", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await tap(page, await wanted(page));
	const id = await page.evaluate(() => (document.querySelector("app-main") as unknown as { lastId: string }).lastId);
	await expect(key(page, id)).toHaveClass(/\bon\b/);
});

test("a held key counts once, not once per auto-repeat", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const ch = await wanted(page);
	const before = await cursorOf(page);
	// What the OS actually sends while a key is down: the first keydown is fresh, the rest are repeats.
	await page.evaluate((c) => {
		for (let i = 0; i < 8; i += 1) window.dispatchEvent(new KeyboardEvent("keydown", { key: c, repeat: i > 0, bubbles: true }));
	}, ch ?? "a");
	await page.waitForTimeout(120);
	expect(await cursorOf(page)).toBe(before + 1);
	// Repeats used to charge an error to the target key, which paints the letter the learner has NOT
	// typed yet red -- the thing that reads as "the line is ahead of me".
	const misses = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { wrong: Set<number> }).wrong.size);
	expect(misses).toBe(0);
});

test("a wrong key does not move the cursor", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const before = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);
	const ch = await wanted(page);
	await tap(page, ch === "z" ? "q" : "z");
	const after = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);
	expect(after).toBe(before);
	await expect(key(page, await page.evaluate(() => (document.querySelector("app-main") as unknown as { lastId: string }).lastId))).toHaveClass(/\bon\b/);
});

test("the board lights the key that was struck, not the one the lesson wanted", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const want = await wanted(page);
	const struck = want === "z" ? "q" : "z";
	expect(await idFor(page, struck)).not.toBe(await idFor(page, want)); // two different keys, or the test proves nothing
	await tap(page, struck);
	await expect(key(page, await idFor(page, struck))).toHaveClass(/\bon\b/);
	await expect(key(page, await idFor(page, want))).not.toHaveClass(/\bon\b/);
});

test("a finished line starts clean", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const text = (await line(page).getAttribute("data-text")) ?? "";
	expect(text.length).toBeGreaterThan(3);
	const want = await wanted(page);
	await tap(page, want === "z" ? "q" : "z"); // leave one red letter behind
	await expect(page.locator("tt-practice .bad")).not.toHaveCount(0);
	for (const ch of [...text]) await tap(page, ch);
	expect(await cursorOf(page)).toBe(0); // a fresh line is on screen
	await expect(page.locator("tt-practice .bad")).toHaveCount(0); // and none of its letters are red
	await expect(page.locator("tt-practice .line .now")).not.toHaveCount(0);
});

test("a single keystroke is enough to persist", async ({ page }) => {
	// The first key after a load is the interesting one: #type used to read the engine reference before
	// calling p.key(), and key() replaces the engine, so that first flush saw undefined and saved nothing.
	// Typing a whole line hid it, because the second key saved everything. One key, then reload.
	await page.goto("/");
	await ready(page);
	// The line exists a moment before the engine has placed a run in it, and wanted() answers "" for that
	// gap -- which silently skipped the keystroke and made this flake under load.
	let ch = await wanted(page);
	for (let i = 0; i < 50 && ch === ""; i += 1) {
		await page.waitForTimeout(20);
		ch = await wanted(page);
	}
	expect(ch).not.toBe("");
	await tap(page, ch);
	await expect.poll(() => storedKeys(page), { timeout: 5000 }).toBe(1);
	await page.reload();
	await ready(page);
	expect(await keysTyped(page)).toBe(1);
});

test("progress survives a reload", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	for (let i = 0; i < 24; i += 1) {
		const ch = await wanted(page);
		if (ch === "") break;
		await tap(page, ch);
	}
	const before = await keysTyped(page);
	expect(before).toBeGreaterThan(2);
	await expect.poll(() => storedKeys(page), { timeout: 5000 }).toBe(before);
	await page.reload();
	await ready(page);
	const after = await keysTyped(page);
	expect(after).toBe(before);
});

test("the unlocked set grows as the keys speed up", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const start = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { ladder: { unlocked: string[] } } }).engine.ladder.unlocked.length);
	// Practise at the goal pace, so every key should clear it.
	for (let i = 0; i < 900; i += 1) {
		const ch = await wanted(page);
		if (ch === "") break;
		await tap(page, ch);
	}
	const now = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { ladder: { unlocked: string[] } } }).engine.ladder.unlocked.length);
	expect(now).toBeGreaterThan(start);
});
