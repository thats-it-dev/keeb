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
	await expect(page.locator("tt-practice .now")).toBeVisible(); // one highlighted letter, keybr-style
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
	await page.locator("app-main .head button").click();
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

test("progress screen shows per-key bars and never invents a speed for an untouched key", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	for (let i = 0; i < 14; i += 1) {
		const ch = await wanted(page);
		if (ch === "") break;
		await tap(page, ch);
	}
	await page.locator("button", { hasText: "Progress" }).click();
	const rows = page.locator(".krow");
	// One row per key on the board, not one row per key with data: a missing key is the useful fact.
	expect(await rows.count()).toBeGreaterThan(30);
	const nums = await page.locator(".krow .num").allInnerTexts();
	// A never-struck key must read as blank, not as a speed. This is the exact lie the screen exists to
	// avoid: an untouched key carries ttMs16 0, and 0 ms per key converts to a triumphant 2400 wpm.
	// Asserting the blank pairing rather than banning high numbers -- synthetic taps on the phone viewport
	// land a few ms apart, so a genuinely practised key can honestly show a silly wpm there.
	const blank = nums.filter((n) => n.trim() === "—").length;
	expect(blank).toBeGreaterThan(0);
	// The same rows must have no bar. If the two disagree, one of them is lying about which keys are empty.
	const widths = await page.locator(".krow .bar").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.width));
	expect(widths.filter((w) => w === "0%").length).toBe(blank);
	// Bars share one capped scale, so nothing may overflow its track.
	expect(widths.every((w) => parseFloat(w) <= 100)).toBe(true);
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
	await tap(page, await wanted(page));
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
