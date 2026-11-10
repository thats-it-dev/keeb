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

// The insight panel's own scroll column. Named directly, not under the shell's aside landmark: Playwright's
// descendant combinator does not cross a slot, and the section reaches the panel that way.
export const paneBody = (page: Page) => page.locator(".insights");

const paneToggle = (page: Page) => page.locator("tk-header .aside-toggle");

// Open or close the insight panel WITHOUT assuming what state it is in now. The shell remembers the choice
// in localStorage, and csp.ts clears that only on a context's first load -- so a test that reloads can
// arrive with the panel already open, and a helper that clicked the toggle would then CLOSE it. Set the
// state, do not toggle it.
export async function openPane(page: Page): Promise<void> {
	if ((await paneToggle(page).getAttribute("aria-expanded")) !== "true") await paneToggle(page).click();
	await expect(paneToggle(page)).toHaveAttribute("aria-expanded", "true");
	await expect(paneBody(page)).toBeVisible();
}

/** The opposite guarantee, for the tests whose whole claim is about a hidden panel. */
export async function closePane(page: Page): Promise<void> {
	if ((await paneToggle(page).getAttribute("aria-expanded")) === "true") await paneToggle(page).click();
	await expect(paneToggle(page)).toHaveAttribute("aria-expanded", "false");
	// Docked, a hidden panel is a 0-width column; on a phone it is a drawer parked off-canvas. Either way
	// the content has no box, which is what toBeHidden waits for after the 0.25s transition.
	await expect(paneBody(page)).toBeHidden();
}
