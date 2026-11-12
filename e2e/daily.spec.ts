// The daily time goal: today's minutes under the numbers, read straight from the local tally, so the bar
// is correct on a signed-out device and before any sync has ever run. The arithmetic and the session-end
// charge live in test/daily.test.ts; this file proves the row reaches the screen.
import type { Page } from "@playwright/test";
import { expect, test } from "./csp.ts";

const bar = (page: Page) => page.locator("app-main").locator(".daily");
const num = (page: Page) => bar(page).locator("tk-bars .row .val");

/** Overwrite today's tally row, so a test starts from a known number of minutes rather than typing them. */
const seedToday = (page: Page, minutes: number) =>
	page.evaluate(
		(min) =>
			new Promise<void>((res, rej) => {
				const d = new Date();
				const day = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
				const open = indexedDB.open("keeb");
				open.onsuccess = () => {
					const tx = open.result.transaction("daily", "readwrite");
					tx.objectStore("daily").clear();
					if (min > 0) tx.objectStore("daily").put({ day, ms: min * 60_000 });
					tx.oncomplete = () => {
						open.result.close();
						res();
					};
					tx.onerror = () => rej(tx.error);
				};
				open.onerror = () => rej(open.error);
			}),
		minutes,
	);

const ready = async (page: Page) => {
	await expect(num(page)).toBeVisible();
};

test("a day nobody has practised shows an empty bar at the shipped goal", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await expect(num(page)).toHaveText("0 min");
	await expect(bar(page).locator(".readout")).toContainText("0 of 1 at goal");
});

test("minutes already on the device show against the goal", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await seedToday(page, 12);
	await page.reload();
	await ready(page);
	await expect(num(page)).toHaveText("12 min");
});

test("a finished day says so in words, not only in a full bar", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await seedToday(page, 16);
	await page.reload();
	await ready(page);
	await expect(num(page)).toHaveText("16 min");
	await expect(bar(page).locator(".readout")).toContainText("1 of 1 at goal");
});

test("the goal follows the learner, not the board", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await page.getByRole("button", { name: "Settings" }).click();
	await page.locator("dialog").getByLabel("daily goal", { exact: false }).fill("30");
	// Switching the board loads a different per-layout settings row. The goal lives outside that row,
	// so the bar must come back on the new board still aimed at 30 minutes of the same tally.
	await page.locator("dialog select").first().selectOption("corne");
	await page.locator("dialog [aria-label='Close settings']").click();
	await expect(page.locator("app-main").locator(".daily").locator("tk-bars .row .val")).toHaveText("0 min");
});

test("the goal is the learner's to set", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await seedToday(page, 12);
	await page.reload();
	await ready(page);
	await page.getByRole("button", { name: "Settings" }).click();
	const input = page.locator("dialog").getByLabel("daily goal", { exact: false });
	await input.fill("30");
	await page.locator("dialog [aria-label='Close settings']").click();
	await expect(num(page)).toHaveText("12 min");
	// 0 is the honest "no goal": the bar disappears rather than claiming an unreachable target.
	await page.getByRole("button", { name: "Settings" }).click();
	await input.fill("0");
	await page.locator("dialog [aria-label='Close settings']").click();
	await expect(bar(page)).toHaveCount(0);
});
