// The settings modal has to stay operable: everything on it reachable inside a short window, nothing
// spilling sideways, and the groups legible enough to scan. These are the "the content doesn't fit the
// modal" complaints written as tests.
import type { Page } from "@playwright/test";
import { expect, test } from "./csp.ts";

const openSettings = async (page: Page) => {
	await page.goto("/");
	await expect(page.locator("tt-practice .line")).toBeVisible();
	await page.getByRole("button", { name: "Settings" }).click();
	await expect(page.locator("dialog")).toBeVisible();
};

test("the dialog fits a short window, and closing stays reachable at the bottom", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 620 });
	await openSettings(page);
	const box = await page.locator("dialog").boundingBox();
	expect(box!.height).toBeLessThanOrEqual(620);
	// Scroll the dialog's own content to the end: the last control must come into view, and the close
	// button must still be there — the modal scrolls, the window does not.
	const last = page.locator("dialog input[type=file]"); // the panel's labels are display:contents; the control has the box
	await last.scrollIntoViewIfNeeded();
	await expect(last).toBeInViewport();
	await expect(page.locator("dialog [aria-label='Close settings']")).toBeInViewport();
});

test("nothing in the dialog overflows sideways", async ({ page }) => {
	await openSettings(page);
	const over = await page.locator("dialog").evaluate((d) => d.scrollWidth - d.clientWidth);
	expect(over).toBeLessThanOrEqual(0);
});

test("settings is grouped into named sections", async ({ page }) => {
	await openSettings(page);
	for (const group of ["keyboard", "practice", "account", "layout files"]) {
		await expect(page.locator("dialog").getByRole("heading", { name: group, level: 3 })).toBeVisible();
	}
});

test("toggles are kit switches, with the label left and the control right", async ({ page }) => {
	await openSettings(page);
	const switches = page.locator("dialog").getByRole("switch");
	await expect(switches).toHaveCount(2);
	for (const name of ["teach in keyboard order", "use real words"]) {
		const sw = page.getByRole("switch", { name });
		await expect(sw).toBeVisible();
		const row = page.locator("dialog .panel label.row", { hasText: name });
		const [s, l, r] = [await sw.boundingBox(), await page.locator("dialog .panel .label", { hasText: name }).first().boundingBox(), await row.boundingBox()];
		// Justify, not merely order: the words start at the row's left edge, the switch ends at its right.
		expect(Math.abs(l!.x - r!.x)).toBeLessThan(2);
		expect(Math.abs(s!.x + s!.width - (r!.x + r!.width))).toBeLessThan(2);
	}
});
