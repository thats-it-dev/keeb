// M3: importing a keyboard-layout json file (info.json) and getting a board out of it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./csp.ts";
import { keyName } from "./keys.ts";

const keycapJson = fileURLToPath(new URL("../test/fixtures/go60-keycap.json", import.meta.url));

// Which option is picked, in the nth select of the settings dialog (0 = keyboard, 1 = keymap).
const selected = (page: Page, nth: number) =>
	page.evaluate((n) => {
		const sel = document.querySelector("app-main")!.shadowRoot!.querySelectorAll("dialog select")[n] as HTMLSelectElement;
		return sel.selectedOptions[0]?.textContent ?? "";
	}, nth);

// A key's printed character, read from the rendered board.
const keycapLegend = (page: Page, id: string) =>
	page.evaluate((key) => document.querySelector("app-main")!.shadowRoot!.querySelector("tt-keyboard")!.shadowRoot!.querySelector(`g[data-id="${key}"] text`)!.textContent, id);

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

test("an imported board is still the selected board after a reload", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await openSettings(page);
	await upload(page, infoJson);
	await page.reload({ waitUntil: "networkidle" });
	await ready(page);
	expect(await options(page)).toContain("go60 info");
	// Being listed is not enough: the field initializers used to resolve against an empty registry and
	// quietly fall back to the shipped default.
	expect(await selected(page, 0)).toBe("go60 info");
});

test("an imported keymap is still the selected keymap after a reload", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await openSettings(page);
	await page.locator("dialog input[type=file]").setInputFiles(keycapJson);
	await expect.poll(() => selected(page, 1)).toBe("go60 keycap");
	await page.reload({ waitUntil: "networkidle" });
	await ready(page);
	expect(await selected(page, 1)).toBe("go60 keycap");
	// and the characters really are the file's, not QWERTY's (the renderer draws a key cap in caps)
	expect(await keycapLegend(page, "L_C5R2")).toMatch(/^b$/i);
	expect(await keycapLegend(page, "R_C2R3")).toMatch(/^h$/i);
});

test("a layout file for a board we do not have says so", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await openSettings(page);
	const other = JSON.parse(readFileSync(keycapJson, "utf8")) as Record<string, unknown>;
	await page.locator("dialog input[type=file]").setInputFiles({
		name: "glove80.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify({ ...other, keyboard: "glove80" })),
	});
	await expect(page.locator("dialog .problems li")).toContainText("glove80");
	expect(await selected(page, 1)).toBe("QWERTY"); // nothing changed
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

// The stats row for one layout, read out of the store: the after-state, not the dialog's say-so.
const statsFor = (page: Page, key: string) =>
	page.evaluate(
		(layoutKey) =>
			new Promise<number>((res, rej) => {
				const open = indexedDB.open("keeb");
				open.onsuccess = () => {
					const r = open.result.transaction("stats").objectStore("stats").getAll();
					r.onsuccess = () => {
						const rows = (r.result ?? []) as { layout: string; value?: Record<string, unknown> }[];
						open.result.close();
						const row = rows.find((row) => row.layout === layoutKey);
						res(row?.value ? Object.keys(row.value).length : 0);
					};
					r.onerror = () => rej(r.error);
				};
				open.onerror = () => rej(open.error);
			}),
		key,
	);

test("orphaned progress can be folded into the surviving layout", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await openSettings(page);
	await upload(page, infoJson);
	await page.getByLabel("Close settings").click();
	await expect(page.locator("tt-practice .line")).toBeVisible();
	// Type a few characters on the imported board so it has stats. The cursor comes from the engine,
	// not the text, because the line re-renders as the lesson advances.
	const line = page.locator("tt-practice .line");
	for (let i = 0; i < 4; i++) {
		const text = (await line.getAttribute("data-text")) ?? "";
		// cursor is a reactive property practice.ts deliberately exposes for tests/callers; there is no
		// other way to read where the line is without asserting on an animation frame.
		const cursor = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);
		const ch = [...text][cursor];
		if (!ch) break;
		await page.locator("tt-practice").press(keyName(ch));
	}
	await expect.poll(() => statsFor(page, "import:go60-info+qwerty")).toBeGreaterThan(0);

	await openSettings(page);
	await page.getByLabel("Remove go60 info").click();
	// The board is gone, but its stats row survives — and the dialog says so.
	await expect(page.locator("dialog .full", { hasText: "orphaned progress" })).toBeVisible();
	// Remap with the default target: the shipped Go60, which is now selected.
	await page.getByRole("button", { name: "Remap" }).click();
	await expect(page.locator("dialog .full", { hasText: "orphaned progress" })).toHaveCount(0);
	// The folded numbers land on the target, and the orphan row is gone.
	await expect.poll(() => statsFor(page, "go60+qwerty")).toBeGreaterThan(0);
	await expect.poll(() => statsFor(page, "import:go60-info+qwerty")).toBe(0);
});

test("an orphan left by an earlier session is offered at boot", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	// Seed an orphan row straight into the store, as a dead layout's numbers would look.
	await page.evaluate(
		() =>
			new Promise<void>((res, rej) => {
				const open = indexedDB.open("keeb");
				open.onsuccess = () => {
					const tx = open.result.transaction("stats", "readwrite");
					tx.objectStore("stats").put({ layout: "import:deleted-board+qwerty", value: { a: { ttMs16: 50, samples: 3, errors: 0 } } });
					tx.oncomplete = () => res();
					tx.onerror = () => rej(tx.error);
				};
				open.onerror = () => rej(open.error);
			}),
	);
	await page.reload({ waitUntil: "networkidle" });
	await ready(page);
	await openSettings(page);
	// The boot scan found it: the row is offered with the raw key, and the Remap button is live.
	await expect(page.locator("dialog .row", { hasText: "import:deleted-board+qwerty" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Remap" })).toBeEnabled();
});
