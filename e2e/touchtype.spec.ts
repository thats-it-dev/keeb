import { loadConfig } from "../vite/config.ts";
import { expect, test } from "./csp.ts";

const { title } = loadConfig();

const key = (page: import("@playwright/test").Page, id: string) => page.locator(`tt-keyboard g[data-id="${id}"]`);

// The keydown listener only exists once the app module has run; pressing before that is a silent no-op.
// toBeVisible matters here: an SVG child built in the wrong namespace is in the DOM but paints nothing.
const ready = async (page: import("@playwright/test").Page) => {
	await expect(page.locator("tt-keyboard g.k").first()).toBeVisible();
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
