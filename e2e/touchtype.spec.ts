import { loadConfig } from "../vite/config.ts";
import { expect, test } from "./csp.ts";

const { title } = loadConfig();

const key = (page: import("@playwright/test").Page, id: string) => page.locator(`tt-keyboard g[data-id="${id}"]`);

// The keydown listener only exists once the app module has run; pressing before that is a silent no-op.
// <g> is not measurable by toBeVisible, so wait on attachment instead.
const ready = async (page: import("@playwright/test").Page) => {
	await expect(page.locator("tt-keyboard g.k").first()).toBeAttached();
};

test("draws the 60 keys of a Go60", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("h1")).toHaveText(title);
	await expect(page.locator("tt-keyboard g.k")).toHaveCount(60);
});

test("highlights the physical key behind the character you typed", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await page.keyboard.press("a");
	await expect(key(page, "L_C5R3")).toHaveClass(/\bon\b/);
	await expect(page.locator("main")).toContainText("left pinky");
	await page.keyboard.press(" ");
	await expect(key(page, "R_T2")).toHaveClass(/\bon\b/);
});

test("the same board re-maps when the keymap changes", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await page.locator("select").last().selectOption("colemak-dh");
	await expect(key(page, "L_C4R3")).toContainText("R"); // where S used to be
	await page.keyboard.press("r");
	await expect(key(page, "L_C4R3")).toHaveClass(/\bon\b/);
});

test("another keyboard means another geometry, same keymap", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await expect(page.locator("tt-keyboard g.k")).toHaveCount(60);
	await page.locator("select").first().selectOption("corne");
	await expect(page.locator("tt-keyboard g.k")).toHaveCount(42);
	await page.keyboard.press("g");
	await expect(key(page, "L1-5")).toHaveClass(/\bon\b/);
});

test("remembers the choice on the next visit", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await page.locator("select").first().selectOption("lily58");
	await page.reload();
	await expect(page.locator("tt-keyboard g.k")).toHaveCount(58);
});
