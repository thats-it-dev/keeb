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
		expect(s!.width).toBeGreaterThanOrEqual(40); // the kit pill, not an empty button passing on position alone
	}
	// The same rule for the grid rows: every label sits on the panel's content edge, every control on the other.
	const panel = page.locator("dialog .panel");
	const pb = await panel.boundingBox();
	const [padL, padR] = await panel.evaluate((el: HTMLElement) => [parseFloat(getComputedStyle(el).paddingLeft), parseFloat(getComputedStyle(el).paddingRight)]);
	for (const t of await page.locator("dialog .panel label > .label").all()) {
		const b = await t.boundingBox();
		expect(Math.abs(b!.x - (pb!.x + padL))).toBeLessThan(2);
	}
	for (const c of await page.locator("dialog .panel label > select, dialog .panel label > input").all()) {
		const b = await c.boundingBox();
		expect(Math.abs(b!.x + b!.width - (pb!.x + pb!.width - padR))).toBeLessThan(2);
	}
});

test("copy diagnostics puts a JSON snapshot on the clipboard", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await openSettings(page);
	// Placement: the button lives inside the account group — below its heading, above the next group's.
	const button = page.getByRole("button", { name: "Copy diagnostics" });
	const accountHeading = page.getByRole("heading", { name: "account", level: 3 });
	const layoutHeading = page.getByRole("heading", { name: "layout files", level: 3 });
	const [b, account, layout] = [await button.boundingBox(), await accountHeading.boundingBox(), await layoutHeading.boundingBox()];
	expect(b!.y).toBeGreaterThan(account!.y);
	expect(b!.y).toBeLessThan(layout!.y);
	await button.click();
	await expect(page.getByText("diagnostics copied to the clipboard")).toBeVisible();
	const clip = await page.evaluate(() => navigator.clipboard.readText());
	const parsed = JSON.parse(clip) as Record<string, unknown>;
	expect(Object.keys(parsed)).toEqual(["generatedAt", "stats", "settings", "history", "layouts", "sync"]);
});
