// M4: sync is an add-on. These check the two things that must hold without a network: the sign-in affordance is
// there when you want it, and nothing about practising depends on it.
import type { Page } from "@playwright/test";
import { expect, test } from "./csp.ts";
import { keyName } from "./keys.ts";

const ready = async (page: Page) => {
	await expect(line(page)).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
};

const line = (page: Page) => page.locator("tt-practice .line");

const openSettings = async (page: Page) => {
	await page.getByRole("button", { name: "Settings" }).click();
	await expect(page.locator("dialog")).toBeVisible();
};

const note = (page: Page) => page.locator("dialog .sync ~ .warn, dialog .warn").last();

test("signing in is offered, and is not required to type", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	// The lesson runs before any account exists.
	const text = (await page.locator("tt-practice .line").getAttribute("data-text")) ?? "";
	await page.locator("tt-practice").press(keyName([...text][0] ?? "a"));
	await expect.poll(() => page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor)).toBe(1);

	await openSettings(page);
	await expect(page.getByLabel("atproto handle")).toBeVisible();
	await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("an empty handle says so instead of navigating anywhere", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await openSettings(page);
	const before = page.url();
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(note(page)).toContainText("handle");
	expect(page.url()).toBe(before); // still here, no half-started oauth redirect
});

test("progress is stored locally with nobody signed in", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const text = (await line(page).getAttribute("data-text")) ?? "";
	for (const ch of [...text].slice(0, 6)) await page.locator("tt-practice").press(keyName(ch));
	await page.reload({ waitUntil: "networkidle" });
	await ready(page);
	// The keyboard readout survives a reload purely from IndexedDB.
	await expect(page.locator(".read").first()).toContainText(/wpm/i);
	const keys = await page.evaluate(() => Object.keys((document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { stats: object } }).engine.stats).length);
	expect(keys).toBeGreaterThan(0);
});
