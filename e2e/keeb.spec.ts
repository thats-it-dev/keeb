// The M1 keyboard view. M2 makes a keystroke mean something (see practice.spec.ts), so these tests
// pick a board that matches what they assert about: f and j are QWERTY's index keys, "r" is where
// Colemak-DH puts its third key on the left middle finger.
import type { Page } from "@playwright/test";
import { loadConfig } from "../vite/config.ts";
import { expect, test } from "./csp.ts";
import { keyName } from "./keys.ts";

const cfg = loadConfig();
// The h1 carries the heading (app.config.json's "heading", falling back to title); the tab carries the
// title. Asserting h1 against title would pass for the wrong app and fail for this one.
const heading = cfg.heading ?? cfg.title;

const key = (page: Page, id: string) => page.locator(`tt-keyboard g[data-id="${id}"]`);

// A keystroke only lands once a lesson is loaded, so wait for the practice line too.
const ready = async (page: Page) => {
	await expect(page.locator("tt-keyboard g.k").first()).toBeVisible();
	await expect(page.locator("tt-practice .line")).toBeVisible();
};

const pickBoard = async (page: Page, id: string) => {
	await page.evaluate((v) => localStorage.setItem("keeb:layout", JSON.stringify({ g: v, k: "qwerty" })), id);
	await page.goto("/");
	await ready(page);
};

test("draws the 60 keys of a Go60", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await expect(page.locator("h1")).toHaveText(heading);
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
	const first = await page.evaluate(() => {
		const p = document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { text: string; pending: string } };
		return { ch: [...p.engine.text][0], id: p.engine.pending };
	});
	await page.locator("tt-practice").press(keyName(first.ch));
	await expect(key(page, first.id)).toHaveClass(/\bon\b/); // the key the engine said was pending
	await expect(page.evaluate(() => (document.querySelector("app-main") as unknown as { lastId: string }).lastId)).resolves.toBe(first.id);
});

test("the same board re-maps when the keymap changes", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await page.locator("tk-header button[aria-label='Settings']").click(); // board and keymap live behind the settings modal
	await page.locator("select").nth(1).selectOption("colemak-dh");
	await page.locator("dialog [aria-label='Close settings']").click(); // typing resumes once it is closed
	await expect(key(page, "L_C4R3")).toContainText("R"); // the key that used to be S
	const wanted = await page.evaluate(() => {
		const p = document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { text: string; pending: string } };
		return { ch: [...p.engine.text][0], id: p.engine.pending };
	});
	await page.locator("tt-practice").press(keyName(wanted.ch));
	await expect(key(page, wanted.id)).toHaveClass(/\bon\b/);
	// Under Colemak-DH the first character of the line lives somewhere else on the board.
	await expect(key(page, wanted.id)).toContainText(wanted.ch.toUpperCase());
});

test("another keyboard means another geometry, same keymap", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await expect(page.locator("tt-keyboard g.k")).toHaveCount(60);
	await pickBoard(page, "corne");
	await expect(page.locator("tt-keyboard g.k")).toHaveCount(42);
	const first = await page.evaluate(() => {
		const p = document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { text: string; pending: string } };
		return { ch: [...p.engine.text][0], id: p.engine.pending };
	});
	await page.locator("tt-practice").press(keyName(first.ch));
	await expect(key(page, first.id)).toHaveClass(/\bon\b/); // the corne id scheme: row 1, column 4 is the left index home key
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
