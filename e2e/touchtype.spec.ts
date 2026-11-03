import { loadConfig } from "../vite/config.ts";
import { expect, test } from "./csp.ts";

const { title } = loadConfig();

// M0: the shell renders and says what is missing. Replace with keyboard tests as M1 lands.
test("shows the status of the build", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("h1")).toHaveText(title);
	await expect(page.locator("main")).toContainText("keyboard view lands in M1");
});

test("states the plan on one screen", async ({ page }) => {
	await page.goto("/");
	const main = page.locator("main");
	await expect(main).toContainText("Go60");
	await expect(main).toContainText("atproto");
});
