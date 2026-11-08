import type { Page } from "@playwright/test";
import { expect } from "./csp.ts";
// Turns a typed character into the Playwright key name for it. The lesson asks for whatever the
// keymap puts under a finger, including punctuation, so a plain `Key${ch}` is not enough.
export function keyName(ch: string): string {
	if (ch === " ") return "Space";
	if (/^[a-z]$/.test(ch)) return `Key${ch.toUpperCase()}`;
	if (/^[A-Z]$/.test(ch)) return `Key${ch}`;
	if (/^[0-9]$/.test(ch)) return `Digit${ch}`;
	const named: Record<string, string> = {
		"-": "Minus",
		"=": "Equal",
		"[": "BracketLeft",
		"]": "BracketRight",
		"\\": "Backslash",
		";": "Semicolon",
		"'": "Quote",
		",": "Comma",
		".": "Period",
		"/": "Slash",
		"`": "Backquote",
	};
	return named[ch] ?? ch;
}

// Fold the insight pane out, whichever shape it took, WITHOUT assuming what state it is in now. The pane
// remembers being open in localStorage, and csp.ts clears that only on a context's first load -- so a test
// that reloads can arrive with the pane already open, and a helper that clicked the rail would then CLOSE it.
// That is what made "open the pane" fail with `hidden` after 15 seconds of waiting. Set the state, do not
// toggle it.
export const openPane = async (page: Page) => {
	if (!(await page.locator("tt-insight-panel .body").isVisible())) await togglePane(page);
	await expect(page.locator("tt-insight-panel .body")).toBeVisible();
	await expect(page.locator("tt-insight-panel .rail")).toHaveAttribute("aria-expanded", "true");
};

/** The opposite guarantee, for the tests whose whole claim is about a folded pane. */
export const closePane = async (page: Page) => {
	if (await page.locator("tt-insight-panel .body").isVisible()) await togglePane(page);
	await expect(page.locator("tt-insight-panel .body")).toBeHidden();
	// Settle both animated numbers. closePane only clicks when the pane ARRIVED open, which means the pane's
	// width and the host's padding-right are both easing from 19rem toward the rail -- and either measured
	// mid-flight reports a value that belongs to no state the app has ever had (measured: 34.46px against a
	// claim of exactly 36px).
	await expect(page.locator("tt-insight-panel")).toHaveCSS("width", "36px");
	await expect(page.locator("app-main")).toHaveCSS("padding-right", "36px");
};

async function togglePane(page: Page): Promise<void> {
	const rail = page.locator("tt-insight-panel .rail");
	// On a phone the pane sits off-canvas, so its own rail is not clickable and the header button is the opener.
	if (await rail.isVisible()) await rail.click();
	else await page.locator("app-main .head button[aria-label='Insights']").click();
}
