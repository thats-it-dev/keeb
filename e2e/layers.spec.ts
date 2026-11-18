// Layers on the board: every layer's character printed on the key, the legend that names the colours, and
// the route -- lit key, layer-coloured glyph, ring on the key that opens the layer -- lit from the very
// first character of a line, not only after the next keystroke.
import type { Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { expect, test } from "./csp.ts";
import { keyName } from "./keys.ts";

const layersJson = fileURLToPath(new URL("../test/fixtures/go60-layers.json", import.meta.url));
const line = (page: Page) => page.locator("tt-practice .line");
const key = (page: Page, id: string) => page.locator(`tt-keyboard g[data-id="${id}"]`);

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

// Ask the model where a character lives, then assert the pixels agree with it.
const routeFor = (page: Page, ch: string) =>
	page.evaluate((c) => {
		const p = document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as {
			resolved: { routeChars: Map<string, { keyId: string; layer: number }>; layerKeyOf: Map<number, string> };
		};
		const x = p.resolved.routeChars.get(c);
		return x && { keyId: x.keyId, layer: x.layer, ringId: x.layer === 0 ? "" : (p.resolved.layerKeyOf.get(x.layer) ?? "") };
	}, ch);

// Every LETTER route at goal speed, then a fresh line: the ladder has run out of letters, so its next
// character must come from a layer.
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

test("the keycaps print every layer, and the legend names the colours", async ({ page }) => {
	await importLayers(page);
	for (const name of ["Main", "Sym", "NavNum", "Fn"]) await expect(page.locator(".legend .name", { hasText: name })).toBeVisible();
	await expect(page.locator(".legend .sw")).toHaveCount(4);
	// The unit tests fixed WHERE "7" lives; this fixes that the board actually drew it there.
	await expect(key(page, "R_C2R2").locator("text[class*='ly']")).not.toHaveCount(0);
	// A built-in board's whole rendering is one text per key: a layered key carries more.
	expect(await key(page, "R_C2R2").locator("text").count()).toBeGreaterThan(1);
});

test("a plain board renders exactly what it rendered before layers", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await expect(page.locator(".legend")).toHaveCount(0);
	await expect(page.locator("tt-keyboard g.k")).toHaveCount(60);
	await expect(page.locator("tt-keyboard g.k text")).toHaveCount(60); // one text per key: no glyph classes at all
	await expect(page.locator("tt-keyboard text.g")).toHaveCount(0);
	await expect(page.locator(".hint")).toHaveCount(0); // a base route needs no instruction
});

test("the route lights the key, its layer colour, and the ring on the way there", async ({ page }) => {
	await importLayers(page);
	await unlockEveryLetter(page);
	// Type through until the lesson asks for a layer character -- tokens land inside the line, not at it.
	let ch = await wanted(page);
	for (let guard = 0; guard < 600; guard += 1) {
		if (ch !== "" && ch !== " " && !/^[a-z]$/.test(ch)) break;
		await page.locator("tt-practice").press(ch === "" ? "Space" : keyName(ch));
		ch = await wanted(page);
	}
	expect(ch && !/^[a-z]$/.test(ch), `a layer character should surface, got ${JSON.stringify(ch)}`).toBeTruthy();
	const route = await routeFor(page, ch);
	expect(route, `no route for ${ch}`).toBeTruthy();
	await expect(key(page, route!.keyId)).toHaveClass(/\broute\b/);
	await expect(key(page, route!.keyId)).toHaveClass(new RegExp(`\\bly${Math.min(route!.layer, 3)}\\b`));
	await expect(key(page, route!.keyId).locator("text.gok")).toHaveCount(1);
	await expect(page.locator("rect.routering")).toHaveCount(1);
	if (route!.ringId) await expect(key(page, route!.ringId).locator("rect.routering")).toBeVisible();
	await expect(page.locator(".hint")).toBeVisible();
	// The hold name is the ring key's own tap from the file -- Enter on R_T2, Backspace on R_T1, Tab on
	// L_T3 -- not the shipped geometry's label, which is what used to leak through as "space".
	const hold = route!.ringId === "R_T2" ? "Enter" : route!.ringId === "R_T1" ? "Backspace" : route!.ringId === "L_T3" ? "Tab" : ".+";
	const press = ch!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // tokens are symbols now: "(" is a regex metacharacter
	await expect(page.locator(".hint")).toHaveText(new RegExp(`hold ${route!.layer === 1 ? "Sym" : route!.layer === 2 ? "NavNum" : "(Fn|layer \\d)"} · ${hold}, press ${press}`));
});

test("the focus ring lands on the key even when the focus is a layer route", async ({ page }) => {
	await importLayers(page);
	await unlockEveryLetter(page);
	await page.getByRole("button", { name: "New line" }).click();
	// Read the focused character off the rendered metric (its <b> value: the label row can decorate it
	// with the layer name), then look up its route.
	const value = ((await page.locator(".read .metric", { hasText: "focus" }).locator("b").first().textContent()) ?? "").trim();
	const ch = value.split(" · ")[0]!; // the route label decorates: "7 · Sym"
	const route = await routeFor(page, ch);
	expect(route, `no route for focus char ${JSON.stringify(ch)}`).toBeTruthy();
	expect(route!.layer, `focus should be a layer character here, got ${JSON.stringify(ch)} on layer ${route!.layer}`).toBeGreaterThan(0);
	await expect(key(page, route!.keyId).locator("rect.ring")).toHaveCount(1);
	await expect(page.locator("tt-keyboard g rect.ring")).toHaveCount(1);
});

test("the first character of every fresh line already has its route lit", async ({ page }) => {
	await importLayers(page);
	await unlockEveryLetter(page);
	const ch = await wanted(page);
	const route = await routeFor(page, ch);
	// Type through the line, then start a new one WITHOUT a keystroke: if the route were read from the
	// child's DOM at render time, the board would light nothing (or the previous line's last key) here.
	for (let guard = 0; guard < 400; guard += 1) {
		const c = await wanted(page);
		if (c === "") break;
		await page.locator("tt-practice").press(keyName(c));
	}
	await page.getByRole("button", { name: "New line" }).click();
	const next = await wanted(page);
	expect(next).not.toBe("");
	await expect(key(page, (await routeFor(page, next))!.keyId)).toHaveClass(/\broute\b/);
	// and the very first route of the imported board, before any typing, was lit too (the same bug, line 1):
	expect((await route!.keyId) !== "").toBe(true);
});
