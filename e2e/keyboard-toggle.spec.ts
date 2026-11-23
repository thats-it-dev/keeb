// The header keyboard button hides and shows the visualisation: the board and the layer hint line.
// The practice pane keeps working while the board is hidden; the choice survives a reload.
// The toggle is a header button, not a settings dialog switch.
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { expect, test } from "./csp.ts";
import { keyName, openPane } from "./keys.ts";

const layersJson = fileURLToPath(new URL("../test/fixtures/go60-layers.json", import.meta.url));

const board = (page: Page) => page.locator("tt-keyboard");
const hint = (page: Page) => page.locator(".hint");
const line = (page: Page) => page.locator("tt-practice .line");
const hideBtn = (page: Page) => page.getByRole("button", { name: "Hide keyboard" });
const showBtn = (page: Page) => page.getByRole("button", { name: "Show keyboard" });
// The open and closed eye differ by the eye-off slash; asserting on the slash path is what ties
// the button's icon to the component's state.
const slash = (page: Page, name: string) => page.locator(`button[aria-label="${name}"] svg path[d="m2 2 20 20"]`);

test("hides and shows the keyboard, and the choice survives a reload", async ({ page }) => {
	await page.goto("/");
	await expect(line(page)).toBeVisible();
	await expect(board(page)).toBeVisible();
	// The label says what the button does, and the state is announced, not just coloured.
	await expect(hideBtn(page)).toBeVisible();
	await expect(hideBtn(page)).toHaveAttribute("aria-pressed", "false");
	// Open eye while the keyboard is visible.
	await expect(slash(page, "Hide keyboard")).toHaveCount(0);

	await hideBtn(page).click();
	await expect(board(page)).toHaveCount(0);
	await expect(showBtn(page)).toBeVisible();
	await expect(showBtn(page)).toHaveAttribute("aria-pressed", "true");
	// Closed eye while it is hidden.
	await expect(slash(page, "Show keyboard")).toHaveCount(1);

	// The line keeps listening while the board is hidden: the wanted key lands, the next span goes hit.
	await expect.poll(() => wanted(page), { timeout: 5000 }).not.toBe("");
	const before = await page.locator("tt-practice .line .hit").count();
	const ch = await wanted(page);
	await page.locator("tt-practice").press(ch === "" ? "Space" : keyName(ch));
	await expect(page.locator("tt-practice .line .hit")).toHaveCount(before + 1);

	// And the rest of the screen stays on screen: the line, the daily bar and the aside's sections.
	await expect(line(page)).toBeVisible();
	await expect(page.locator(".daily")).toBeVisible();
	await expect(page.locator(".read")).toBeVisible();
	await openPane(page);
	await expect(page.locator(".insights .stats")).toBeVisible();

	await page.reload();
	// A reload must arrive fully rendered before the count-0 is read; otherwise the assertion passes
	// in the first frame, before the page ever had a chance to render the board.
	await expect(line(page)).toBeVisible();
	await expect(board(page)).toHaveCount(0); // remembered

	await showBtn(page).click();
	await expect(board(page)).toBeVisible(); // back
	await expect(slash(page, "Hide keyboard")).toHaveCount(0);

	await page.reload();
	await expect(line(page)).toBeVisible();
	await expect(board(page)).toBeVisible(); // visible again after a reload

	// The plan's third leg: hidden again in-session, not just re-remembered after a reload.
	await hideBtn(page).click();
	await expect(board(page)).toHaveCount(0);
	await expect(slash(page, "Show keyboard")).toHaveCount(1);
});

// A layered board puts a hint line under the board; the hint is half of what hides, so it gets its
// own proof. The layer fixture and the unlock/type pattern come from layers.spec.ts.
test("the layer hint hides with the board", async ({ page }) => {
	await importLayers(page);
	await unlockEveryLetter(page);
	let ch = await wanted(page);
	for (let guard = 0; guard < 600; guard += 1) {
		if (ch !== "" && ch !== " " && !/^[a-z]$/.test(ch)) break;
		await page.locator("tt-practice").press(ch === "" ? "Space" : keyName(ch));
		ch = await wanted(page);
	}
	expect(ch && !/^[a-z]$/.test(ch), `a layer character should surface, got ${JSON.stringify(ch)}`).toBeTruthy();
	// The board and the hint render together, so the hint is visible before the click — then the
	// hide click must remove the hint too, not just the board.
	await expect(hint(page)).toBeVisible();

	await hideBtn(page).click();
	await expect(board(page)).toHaveCount(0);
	await expect(hint(page)).toHaveCount(0);
});

// The same imports, waits and helpers layers.spec.ts uses for the layered board.
const ready = async (page: Page) => {
	await expect(line(page)).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
};

const importLayers = async (page: Page) => {
	await page.goto("/");
	await ready(page);
	await page.getByRole("button", { name: "Settings" }).click();
	await page.locator("dialog input[type=file]").setInputFiles(layersJson);
	await page.getByLabel("Close settings").click();
	await ready(page);
};

const wanted = (page: Page): Promise<string> =>
	page.evaluate(() => {
		const p = document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { text: string; index: number } };
		return [...p.engine.text][p.engine.index] ?? "";
	});

const unlockEveryLetter = async (page: Page) => {
	await page.evaluate(async () => {
		const a = document.querySelector("app-main") as unknown as { stats: Record<string, unknown> };
		const p = a.shadowRoot!.querySelector("tt-practice") as unknown as { resolved: { routes: { char: string; statId: string }[] }; begin(): void };
		for (const x of p.resolved.routes) if (/^[a-z]$/.test(x.char)) a.stats[x.statId] = { ttMs16: 4800, bestMs16: 4800, samples: 40, errors: 0 };
		await new Promise((res) => requestAnimationFrame(res));
		p.begin();
	});
	await expect(line(page)).toBeVisible();
};
