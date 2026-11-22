// The header keyboard button hides and shows the visualisation: the board and the layer hint line.
// The practice pane, the progress list and the readout are untouched by it. Local persistence is
// the contract; the switch itself is a header button, not a settings dialog switch.
import type { Page } from "@playwright/test";
import { expect, test } from "./csp.ts";

const button = (page: Page) => page.getByRole("button", { name: /keyboard/i }).last();
const board = (page: Page) => page.locator("tt-keyboard");

test("hides and shows the keyboard, and the choice survives a reload", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("tt-practice .line")).toBeVisible();
	await expect(board(page)).toBeVisible();

	await button(page).click();
	await expect(board(page)).toHaveCount(0);

	await page.reload();
	await expect(board(page)).toHaveCount(0); // remembered

	await button(page).click();
	await expect(board(page)).toBeVisible(); // back

	await page.reload();
	await expect(board(page)).toBeVisible(); // visible again after a reload
});
