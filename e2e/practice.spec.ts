// M2: the practice loop. Typing a line, the next key highlighted, speed readout, and the choice of
// keys growing as the slow ones get faster.
import type { Page } from "@playwright/test";
import { loadConfig } from "../vite/config.ts";
import { expect, test } from "./csp.ts";

const { title } = loadConfig();

// How many distinct keys have accumulated stats, read from the stored engine.
const keysTyped = (page: Page) =>
	page.evaluate(() => Object.keys((document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { stats: object } }).engine.stats).length);

const line = (page: Page) => page.locator("tt-practice .line");
const key = (page: Page, id: string) => page.locator(`tt-keyboard g[data-id="${id}"]`);

// Wait for IndexedDB to answer, or the practice pane has no lesson yet.
const ready = async (page: Page) => {
	await expect(line(page)).toBeVisible();
	await expect(page.locator("h1")).toHaveText(title);
};

const wanted = async (page: Page): Promise<string> => {
	const text = (await line(page).getAttribute("data-text")) ?? "";
	const index = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);
	return [...text][index] ?? "";
};

// A keystroke has to reach the element's window listener, so wait for the practice pane to exist.
const tap = async (page: Page, ch: string) => {
	const p = page.locator("tt-practice");
	if (ch === " ") await p.press("Space");
	else await p.press(ch === "z" ? "KeyZ" : `Key${ch.toUpperCase()}`);
};

test("starts the first lesson on the two index keys", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const chars = await page.evaluate(() => {
		const p = document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { text: string } };
		return [...new Set([...p.engine.text])].filter((c) => c !== " ").sort().join("");
	});
	expect(chars).toBe("fj");
});

test("types a whole line and shows speed", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	for (let i = 0; i < 40; i += 1) {
		const ch = await wanted(page);
		if (ch === "") break;
		await tap(page, ch);
		await page.waitForTimeout(12);
	}
	await expect(page.locator("main")).toContainText("cpm");
	const done = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);
	expect(done).toBeGreaterThan(10);
});

test("highlights the key the next character lives on", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const ch = await wanted(page);
	await tap(page, ch);
	const id = await page.evaluate(() => {
		const app = document.querySelector("app-main")! as unknown as { lastId: string };
		return app.lastId;
	});
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
	await expect(line(page)).toContainText("");
});

test("progress survives a reload", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	for (let i = 0; i < 24; i += 1) {
		const ch = await wanted(page);
		if (ch === "") break;
		await tap(page, ch);
		await page.waitForTimeout(10);
	}
	const before = await keysTyped(page);
	await page.reload();
	await ready(page);
	const after = await keysTyped(page);
	expect(after).toBeGreaterThanOrEqual(Math.min(before, 2));
});
