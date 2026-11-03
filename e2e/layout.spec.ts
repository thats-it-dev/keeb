// M3: importing a keyboard-layout json file (info.json) and getting a board out of it.
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./csp.ts";

const infoJson = fileURLToPath(new URL("../test/fixtures/go60-info.json", import.meta.url));

const boardCount = (page: Page) => page.evaluate(() => document.querySelector("app-main")!.shadowRoot!.querySelector("tt-keyboard")!.shadowRoot!.querySelectorAll("g.k").length);
const options = (page: Page) => page.evaluate(() => [...document.querySelector("app-main")!.shadowRoot!.querySelectorAll("dialog select")[0].options].map((o) => o.textContent));

const ready = async (page: Page) => {
	await expect(page.locator("tt-practice .line")).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
};

const openSettings = async (page: Page) => {
	await page.getByRole("button", { name: "Settings" }).click();
	await expect(page.locator("dialog")).toBeVisible();
};

const upload = async (page: Page, path: string) => {
	await page.locator("dialog input[type=file]").setInputFiles(path);
	await expect.poll(() => options(page).then((o) => o.length)).toBe(5);
};

test("an uploaded layout becomes a selectable board", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await openSettings(page);
	await upload(page, infoJson);
	expect(await options(page)).toContain("go60 info");
	expect(await page.locator("dialog .board").textContent()).toContain("60 keys");
	await page.getByLabel("Close settings").click();
	expect(await boardCount(page)).toBe(60); // the imported geometry is what now renders
	await expect(page.locator(".warn")).toContainText("came from"); // and it says where the data came from
});

test("an imported board is still there after a reload", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await openSettings(page);
	await upload(page, infoJson);
	await page.reload({ waitUntil: "networkidle" });
	await ready(page);
	expect(await options(page)).toContain("go60 info"); // registered from IndexedDB before the saved pick is read
	expect(await boardCount(page)).toBe(60);
});

test("uploading the same file again replaces the board instead of duplicating it", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await openSettings(page);
	await upload(page, infoJson);
	await page.locator("dialog input[type=file]").setInputFiles(infoJson);
	await expect.poll(() => options(page).then((o) => o.filter((n) => n === "go60 info").length)).toBe(1);
});

test("a file that is not a layout says so, and changes nothing", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await openSettings(page);
	const before = await options(page);
	await page.locator("dialog input[type=file]").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from('{"hello":"world"}') });
	await expect(page.locator("dialog .problems li")).toContainText("layouts");
	expect(await options(page)).toEqual(before);
});

test("removing an imported board leaves the shipped ones", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await openSettings(page);
	await upload(page, infoJson);
	await page.getByLabel("Remove go60 info").click();
	await expect.poll(() => options(page).then((o) => o.length)).toBe(4);
	expect(await boardCount(page)).toBe(60); // back to the shipped Go60, which has the same shape
});
