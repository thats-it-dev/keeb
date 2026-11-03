// The M1 keyboard view. M2 makes a keystroke mean something (see practice.spec.ts), so these tests
// pick a board that matches what they assert about: f and j are QWERTY's index keys, "r" is where
// Colemak-DH puts its third key on the left middle finger.
import type { Page } from "@playwright/test";
import { loadConfig } from "../vite/config.ts";
import { expect, test } from "./csp.ts";

const { title } = loadConfig();

const key = (page: Page, id: string) => page.locator(`tt-keyboard g[data-id="${id}"]`);

// A keystroke only lands once a lesson is loaded, so wait for the practice line too.
const ready = async (page: Page) => {
	await expect(page.locator("tt-keyboard g.k").first()).toBeVisible();
	await expect(page.locator("tt-practice .line")).toBeVisible();
};

const pickBoard = async (page: Page, id: string) => {
	await page.evaluate((v) => localStorage.setItem("touchtype:layout", JSON.stringify({ g: v, k: "qwerty" })), id);
	await page.goto("/");
	await ready(page);
};

test("draws the 60 keys of a Go60", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await expect(page.locator("h1")).toHaveText(title);
	await expect(page.locator("tt-keyboard g.k")).toHaveCount(60);
});

test("paints the whole board before anything is clicked", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const svg = await page.locator("tt-keyboard svg").boundingBox();
	const far = await key(page, "R_C6R3").boundingBox(); // the right-hand outer column
	expect(far && svg && far.x > svg.x + svg.width * 0.5).toBe(true);
	expect(far!.x + far!.width).toBeLessThanOrEqual(svg!.x + svg!.width + 1);
});

test("marks the keys a keymap does not claim", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await expect(key(page, "L_C6R2")).toHaveClass(/\bunt\b/); // the Tab column: on the board, not in the lesson
	await expect(key(page, "L_C5R3")).not.toHaveClass(/\bunt\b/); // "a"
	const box = await key(page, "L_C5R3").boundingBox();
	expect(box && box.width).toBeGreaterThan(20); // and it actually occupies pixels
});

test("highlights the physical key of the character you typed", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const wanted = await page.evaluate(() => {
		const p = document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { text: string; pending: string } };
		return [...p.engine.text][0];
	});
	await page.locator("tt-practice").press(`Key${wanted.toUpperCase()}`);
	await expect(key(page, `L_C2R3`)).toHaveClass(/\bon\b/); // the key the engine said was pending
	await expect(page.evaluate(() => (document.querySelector("app-main") as unknown as { lastId: string }).lastId)).resolves.toBe("L_C2R3");
});

test("the same board re-maps when the keymap changes", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await page.locator("select").nth(1).selectOption("colemak-dh");
	await expect(key(page, "L_C4R3")).toContainText("R"); // the key that used to be S
	await page.locator("tt-practice").press("KeyD");
	await expect(key(page, "L_C2R3")).toHaveClass(/\bon\b/);
});

test("another keyboard means another geometry, same keymap", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await expect(page.locator("tt-keyboard g.k")).toHaveCount(60);
	await pickBoard(page, "corne");
	await expect(page.locator("tt-keyboard g.k")).toHaveCount(42);
	await page.locator("tt-practice").press("KeyF");
	await expect(key(page, "L1-4")).toHaveClass(/\bon\b/); // home row, left index
});

test("remembers the choice on the next visit", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await pickBoard(page, "lily58");
	await expect(page.locator("tt-keyboard g.k")).toHaveCount(58);
	await page.reload();
	await ready(page);
	await expect(page.locator("tt-keyboard g.k")).toHaveCount(58);
});
