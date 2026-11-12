// M5: the practice history. Sessions live on the PDS and are cached in IndexedDB, so these tests seed
// the cache directly -- signing in from a browser test would need a real account and a real PKCE dance.
import type { Page } from "@playwright/test";
import { expect, test } from "./csp.ts";
import { closePane, openPane, paneBody } from "./keys.ts";

type Stat = { ttMs16: number; samples: number; errors: number };
type Row = { rkey: string; layout: string; atMs: number; chars: number; errors: number; ms: number; stats: Record<string, Stat> };

const noon = (daysAgo: number) => {
	const d = new Date();
	d.setDate(d.getDate() - daysAgo);
	d.setHours(12, 0, 0, 0);
	return d.getTime();
};

const row = (over: Partial<Row> & { rkey: string; atMs: number }): Row => ({ layout: "go60+qwerty", chars: 500, errors: 4, ms: 60_000, stats: {}, ...over });

const seed = (page: Page, rows: Row[]) =>
	page.evaluate((rs) => {
		return new Promise<void>((res, rej) => {
			// No version argument: opening at a version would run an upgrade, and an upgrade from here would
			// create only this one store -- leaving the app's own connection to find stats and settings
			// missing. Callers must wait for the app to have booted first, so the database already exists.
			const db = indexedDB.open("keeb");
			db.onsuccess = () => {
				if (!db.result.objectStoreNames.contains("history")) {
					db.result.close();
					rej(new Error("history store is missing: the app did not finish opening the database"));
					return;
				}
				const tx = db.result.transaction("history", "readwrite");
				for (const r of rs) tx.objectStore("history").put(r);
				tx.oncomplete = () => {
					db.result.close();
					res();
				};
				tx.onerror = () => rej(tx.error);
			};
			db.onerror = () => rej(db.error);
			db.onblocked = () => rej(new Error("database open was blocked by another connection"));
		});
	}, rows);


// The app reads the cache once, on boot, so seed first and then load.
const seedAndOpen = async (page: Page, rows: Row[]) => {
	await page.goto("/");
	await expect(page.locator("tt-practice .line")).toBeVisible(); // the app has opened the database by now
	await seed(page, rows);
	await page.reload();
	await expect(page.locator("tt-practice .line")).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	// There is no Progress screen to navigate to any more: the history and the key bars are sections of the
	// insight pane, and the pane arrives folded. Opening it is the whole of what used to be a click on
	// "Progress" plus a click on the rail.
	await openPane(page);
};

test("cached sessions draw a curve and honest totals", async ({ page }) => {
	await seedAndOpen(page, [
		row({ rkey: "aaa", atMs: noon(0), chars: 400, ms: 60_000 }),
		row({ rkey: "aab", atMs: noon(1), chars: 500, errors: 20, ms: 60_000 }),
		row({ rkey: "aac", atMs: noon(2), chars: 600, ms: 120_000 }),
	]);
	await expect(page.locator(".hist")).toBeVisible();
	expect(await page.locator(".hist .line.s1").getAttribute("d")).toContain("M");
	expect(await page.locator(".hist .line.s2").getAttribute("d")).toBe("");
	await expect(page.locator(".hist tk-timeseries .goal")).toHaveCount(1);
	const card = (name: string) => page.locator(".hist .card", { hasText: name }).locator("b");
	await expect(card("characters")).toHaveText("1500"); // 400 + 500 + 600, a real stroke count
	await expect(card("sessions")).toHaveText("3");
	await expect(card("practised")).toHaveText("4 min");
	await expect(card("streak")).toHaveText("3 d");
});

test("a day with no sessions is a gap, not a point on a line", async ({ page }) => {
	await seedAndOpen(page, [row({ rkey: "b1", atMs: noon(0) }), row({ rkey: "b2", atMs: noon(1) }), row({ rkey: "b3", atMs: noon(2) }), row({ rkey: "b4", atMs: noon(6) })]);
	const d = (await page.locator(".hist .line.s1").getAttribute("d")) ?? "";
	// Kit draws the isolated day as both a zero-length path stub and a dot, so the path holds two M's:
	// the three-day run and the stub. The visible break is the hole; the dot marks the isolated day.
	expect(d.split("M").length - 1).toBe(2);
	expect(await page.locator(".hist .dot").count()).toBe(1); // isolated day renders as a dot
	await expect(page.locator(".hist .card", { hasText: "streak" }).locator("b")).toHaveText("3 d");
});

test("a day with sessions but no characters dips to the axis, not a gap", async ({ page }) => {
	await seedAndOpen(page, [row({ rkey: "z1", atMs: noon(0), chars: 300 }), row({ rkey: "z2", atMs: noon(1), chars: 0 })]);
	// sessions > 0 keeps the day in the line even at 0 wpm: one continuous run, no isolated dot.
	expect(((await page.locator(".hist .line.s1").getAttribute("d")) ?? "").split("M").length - 1).toBe(1);
	expect(await page.locator(".hist .dot").count()).toBe(0);
});

test("history from another board does not leak into this one's chart", async ({ page }) => {
	await seedAndOpen(page, [
		row({ rkey: "c1", atMs: noon(0), layout: "corne+colemak_dh", chars: 900 }),
		row({ rkey: "c2", atMs: noon(1), layout: "corne+colemak_dh", chars: 900 }),
	]);
	// Speed on a Corne says nothing about the same fingers on a Go60, so the section is simply absent.
	// The section is absent, not merely hidden: #history() renders nothing at all when no session names this
	// layout, which is what a count of 0 used to prove when the chart lived on the page.
	await expect(page.locator(".hist")).toHaveCount(0);
	// The progress pane is still there and still talking about this board -- the history was filtered out,
	// not the screen. Nothing has been typed locally, so it shows the "hit a key first" state.
	await expect(page.locator(".stats h3")).toContainText("progress");
	await expect(page.locator(".stats")).toContainText("A key gets a bar");
});

test("a session with no readable date counts, but is not drawn", async ({ page }) => {
	await seedAndOpen(page, [row({ rkey: "d1", atMs: 0, chars: 700, ms: 60_000 }), row({ rkey: "d2", atMs: noon(0), chars: 300, ms: 60_000 })]);
	expect(await page.locator(".hist .dot").count()).toBe(1); // the undated one is in the totals only
	await expect(page.locator(".hist .card", { hasText: "characters" }).locator("b")).toHaveText("1000");
	await expect(page.locator(".hist .card", { hasText: "sessions" }).locator("b")).toHaveText("2");
	await expect(page.locator(".hist")).toContainText("no readable date");
});

test("with nothing synced there is no history section", async ({ page }) => {
	// Doubles as the gating check: this runs on localhost, which is not a Pages preview host, so the
	// "show demo sessions" prompt must stay absent off a preview.
	await page.goto("/");
	await expect(page.locator("tt-practice .line")).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	await openPane(page);
	await expect(page.locator(".hist")).toHaveCount(0);
	// The key-progress part of the pane still works offline.
	await expect(page.locator(".stats h3")).toContainText("progress");
});

test("?demo=1 draws a labelled curve and stores nothing", async ({ page }) => {
	await page.goto("/?demo=1");
	await expect(page.locator("tt-practice .line")).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	await openPane(page);
	// The demo prompt lives in the history section, which lives in the pane. On a real branch preview the pane
	// starts open; this is localhost, so the test folds it out by hand.
	await openPane(page);
	await expect(page.locator(".demo-note")).toContainText("demo sessions");
	await expect(page.locator(".demo-note")).toContainText("nothing here is your progress");
	expect(await page.locator(".hist .line.s1").getAttribute("d")).toContain("M");
	// The claim that matters: generated per render, never written down. A preview must not be able to put a
	// made-up session in a real repo or in this device's cache.
	const stored = await page.evaluate(
		() =>
			new Promise<number>((res, rej) => {
				const db = indexedDB.open("keeb");
				db.onsuccess = () => {
					const r = db.result.transaction("history").objectStore("history").getAll();
					r.onsuccess = () => {
						db.result.close();
						res((r.result ?? []).length);
					};
					r.onerror = () => rej(r.error);
				};
				db.onerror = () => rej(db.error);
			}),
	);
	expect(stored).toBe(0);
	// Turning it off is reflected in the URL, so a reloaded preview cannot come back quietly faked.
	await page.locator(".demo-note button", { hasText: "Use real data" }).click();
	await expect(page.locator(".hist")).toHaveCount(0);
	expect(page.url()).not.toContain("demo");
	await page.reload();
	await expect(page.locator("tt-practice .line")).toBeVisible();
	await openPane(page);
	await expect(page.locator(".hist")).toHaveCount(0);
});

test("the chart draws the pausing, and refuses to draw it without the data", async ({ page }) => {
	const withStats = (i: number, strokes: number) =>
		row({
			rkey: `s${String(i).padStart(3, "0")}`,
			atMs: noon(23 - i), // consecutive days, so the line is one run rather than four single-point segments
			chars: strokes,
			ms: 120_000,
			// Cumulative, the way a record is: the snapshot is the state of the key when the session ended.
			stats: { a: { ttMs16: 300 * 16, samples: strokes * (i + 1), errors: 0 } },
		});
	const rows = [withStats(0, 60), withStats(1, 60), withStats(2, 60), withStats(3, 60)];
	await page.goto("/");
	await page.locator("tt-practice .line").waitFor();
	await seed(page, rows);
	await page.reload();
	await openPane(page);
	await page.locator(".hist .line.s1").waitFor({ state: "attached" }); // chart lays out once the pane has a width

	// The SVG lives in the chart's shadow root, so read it through the locator (which pierces shadow
	// DOM) rather than a querySelector inside evaluate. The band is only rendered when there is stroke
	// data, so an absent path is the "no band" answer rather than a locator that waits forever.
	const pathD = async (sel: string) => {
		const loc = page.locator(`.hist ${sel}`);
		if ((await loc.count()) === 0) return "";
		return (await loc.first().getAttribute("d")) ?? "";
	};
	const paths = { s1: await pathD(".line.s1"), s2: await pathD(".line.s2"), band: await pathD(".band") };
	expect(paths.s1).not.toBe("");
	// Two separate lines: the clock speed, and the same characters over the stroke time alone.
	expect(paths.s2).not.toBe("");
	expect(paths.s2).not.toBe(paths.s1);
	// A higher wpm is a smaller y in SVG space, so every point of the typing line sits ABOVE the clock line
	// on the same day, and the band between them is the time that was not spent typing.
	expect(paths.band).not.toBe("");
	expect(paths.s2.split("L").length).toBe(4); // one run, four consecutive days
	const ys = (d: string) => [...d.matchAll(/([\d.]+),([\d.]+)/g)].map((m) => Number(m[2]));
	const clockY = ys(paths.s1);
	const typingY = ys(paths.s2);
	expect(typingY).toHaveLength(clockY.length);
	typingY.forEach((y, i) => expect(y, `day ${i}`).toBeLessThan(clockY[i]!));

	// Now the same days with the per-key snapshot removed. Records written before stats existed look like
	// this, and the honest chart draws one line and no band -- not a band filled all the way to the axis,
	// which would read as "every second of this session was spent hesitating".
	await seed(page, rows.map((r) => ({ ...r, stats: {} })));
	await page.reload();
	await openPane(page);
	await page.locator(".hist .line.s1").waitFor({ state: "attached" });
	const bare = { s1: await pathD(".line.s1"), s2: await pathD(".line.s2"), band: await pathD(".band") };
	expect(bare.s1).not.toBe("");
	expect(bare.s2).toBe("");
	expect(bare.band).toBe("");
});

test("the insight panel is collapsed by default, opens, and remembers", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "phone", "the desktop column path; the drawer has its own test");
	const rows: Row[] = [];
	let samples = 20;
	for (let i = 0; i < 12; i += 1) {
		samples += 25;
		// A cumulative snapshot, the way the real records carry it: the mean falls and the sample count only ever rises.
		rows.push(row({ rkey: `r${i}`, atMs: noon(12 - i), chars: 120, ms: 90_000, stats: { a: { ttMs16: (300 - i * 8) * 16, samples, errors: 2 } } }));
	}
	await page.goto("/");
	await page.locator("tt-practice .line").waitFor();
	await seed(page, rows);
	await page.reload();
	await closePane(page); // hidden on purpose; see the note in closePane about inherited state

	const toggle = page.locator("tk-header .aside-toggle");
	// Closed: the cards exist in the DOM but are clipped to a 0-width column, so opening costs no re-render
	// of the chart. Scoped to the insights' own children: naming .card bare would also count the history totals.
	await expect(page.locator(".insights > .card")).toHaveCount(3);
	await expect(paneBody(page)).toBeHidden();
	await expect(toggle).toHaveAttribute("aria-expanded", "false");

	await toggle.click();
	await expect(paneBody(page)).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	// The hesitation card is the reason the panel exists, so it must carry a number, not just prose.
	await expect(page.locator('[data-id="hesitation"] .big')).toContainText("wpm");

	await page.reload();
	// No openPane() here: the claim IS that nothing needs clicking. Opening it by hand would pass the test
	// and defeat it.
	await expect(paneBody(page)).toBeVisible(); // remembered, without a click
});

test("an empty panel explains itself instead of showing three blank cards", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "phone", "the desktop column path; the drawer has its own test");
	await page.goto("/");
	await page.locator("tt-practice .line").waitFor();
	await seed(page, [row({ rkey: "solo", atMs: noon(0), stats: {} })]);
	await page.reload();
	await openPane(page);
	const panel = page.locator(".insights");
	// A card with nothing to say is worse than no card: it reads as "zero", not as "unknown". So every card
	// has to carry a sentence, and the one with a number must not contradict it.
	for (const id of ["hesitation", "trends", "milestones"]) {
		const say = (await panel.locator(`[data-id="${id}"] .say`).innerText()).trim();
		expect(say.length, id).toBeGreaterThan(20);
		expect(say, id).not.toMatch(/undefined|NaN|null/);
	}
	await expect(panel.locator('[data-id="milestones"] .say')).toContainText(/averages under|no session/i);
});

test("a collapsed panel takes no keyboard focus", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "phone", "the desktop column path; the drawer has its own test");
	await page.goto("/");
	await page.locator("tt-practice .line").waitFor();
	await seed(page, [row({ rkey: "one", atMs: noon(0) })]);
	await page.reload();
	await closePane(page);
	const col = page.locator("aside[aria-label='Insights']");
	// Hidden, and that is the whole claim: a closed panel must not hold focus. The shell marks the column inert.
	await expect(paneBody(page)).toBeHidden();
	await expect(col).toHaveAttribute("inert");
	// Tab from the top of the screen: the toggle is reachable, the cards inside it are not. One focus() on a
	// card is the whole claim -- inert makes focus() a no-op, so activeElement stays where it was.
	const toggle = page.locator("tk-header .aside-toggle");
	await toggle.focus();
	await expect(toggle).toBeFocused();
	await page.locator(".insights > .card").first().evaluate((el) => (el as HTMLElement).focus());
	await expect(toggle).toBeFocused();
	await expect(page.locator(".insights > .card").first()).not.toBeFocused();
});

test("the panel comes back the way you left it after a reload", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "phone", "the desktop column path; the drawer has its own test");
	await page.goto("/");
	await page.locator("tt-practice .line").waitFor();
	await seed(page, [row({ rkey: "one", atMs: noon(0) })]);
	await page.reload();
	await closePane(page); // the test's first claim is about a hidden panel
	const toggle = page.locator("tk-header .aside-toggle");

	// Open it, then reload: the state must survive without a click.
	await toggle.click();
	await expect(paneBody(page)).toBeVisible();
	await page.reload();
	// No clicking here either: surviving the reload without a click IS the assertion.
	await expect(paneBody(page)).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-expanded", "true");

	// Close it, then reload again. This is the half that a presence-based attribute gets wrong: storage holds
	// "false", and reading that as "anything stored means open" would silently reopen the panel forever.
	await toggle.click();
	await expect(paneBody(page)).toBeHidden();
	await page.reload();
	// Nothing clicked: storage says the column is hidden, and reading a present key as "open" would reopen
	// this forever.
	await expect(paneBody(page)).toBeHidden();
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("the pane is a full-height shell column, not a card in the section", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "phone", "this is the desktop column geometry; the drawer has its own test");
	const rows: Row[] = [];
	let samples = 20;
	for (let i = 0; i < 12; i += 1) {
		samples += 25;
		rows.push(row({ rkey: `w${i}`, atMs: noon(12 - i), chars: 120, ms: 90_000, stats: { a: { ttMs16: (300 - i * 8) * 16, samples, errors: 2 } } }));
	}
	await page.goto("/");
	await page.locator("tt-practice .line").waitFor();
	await seed(page, rows);
	await page.reload();
	await closePane(page); // this test measures the closed and the open column in turn
	const col = page.locator("aside[aria-label='Insights']");
	const vp = page.viewportSize()!;

	// It belongs to the shell. Hidden, it is a 0-wide track with no border, so it cannot stick out of the track;
	// and the grid track is transitioned, so measure only what has settled.
	await expect(col).toHaveCSS("border-left-width", "0px");
	await expect.poll(() => col.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(0);

	await page.locator("tk-header .aside-toggle").click();
	await expect(paneBody(page)).toBeVisible();
	// Open: full height, flush with the right edge, one rule facing the content.
	const asideW = 300; // --aside-w
	await expect.poll(() => col.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(asideW);
	await expect(col).toHaveCSS("border-top-width", "0px");
	await expect(col).toHaveCSS("border-right-width", "0px");
	await expect(col).toHaveCSS("border-bottom-width", "0px");
	await expect(col).toHaveCSS("border-left-width", "1px");
	const box = await col.boundingBox();
	expect(Math.round(box!.y)).toBe(0);
	expect(Math.round(box!.height)).toBe(vp.height); // opening sideways: never taller
	expect(Math.round(box!.x + box!.width)).toBe(vp.width);

	// The cards scroll inside the column rather than extending the page.
	expect(await paneBody(page).evaluate((el) => el.scrollHeight >= el.clientHeight)).toBe(true);

	// And the history is a section of THIS panel: it sits directly in the aside column, and none of it is
	// left inside the progress section.
	expect(await page.locator(".insights > .hist tk-timeseries").count()).toBe(1);
	await expect(page.locator(".stats .hist")).toHaveCount(0);
});
test("on a phone the pane is a side menu", async ({ page }) => {
	const rows: Row[] = [];
	let samples = 20;
	for (let i = 0; i < 12; i += 1) {
		samples += 25;
		rows.push(row({ rkey: `p${i}`, atMs: noon(12 - i), chars: 120, ms: 90_000, stats: { a: { ttMs16: (300 - i * 8) * 16, samples, errors: 2 } } }));
	}
	await page.setViewportSize({ width: 390, height: 780 });
	await page.goto("/");
	await page.locator("tt-practice .line").waitFor();
	await seed(page, rows);
	await page.reload();

	const col = page.locator("aside[aria-label='Insights']");
	const vp = page.viewportSize()!;
	// Closed and off-canvas: parked past the right edge, and out of the tab order, which visibility:hidden is
	// what buys -- a translate alone would leave its buttons focusable.
	await expect(col).toHaveCSS("visibility", "hidden");
	expect(Math.round((await col.boundingBox())!.x)).toBeGreaterThanOrEqual(vp.width - 1);
	// Nothing is reserved on a phone: the page keeps its full width and the drawer covers it.
	await expect(page.locator(".page")).toHaveCSS("width", `${vp.width}px`);

	// The header carries the only opener.
	const openBtn = page.locator("tk-header .aside-toggle");
	await expect(openBtn).toBeVisible();
	await openBtn.click();
	await expect(col).toHaveCSS("visibility", "visible");
	await expect(paneBody(page)).toBeVisible();
	// Wait for the slide to finish: transform animates over 0.25s, and a box measured mid-flight reports the
	// drawer still parked off-screen.
	await expect(col).toHaveCSS("transform", "none");
	const box = await col.boundingBox();
	expect(box!.width).toBeGreaterThan(200); // min(85vw, 360px)
	expect(Math.round(box!.x + box!.width)).toBe(vp.width);

	// The overlay dismisses it, which is the gesture a side menu is expected to answer.
	await page.locator("tk-shell .overlay").click({ position: { x: 20, y: 300 } });
	await expect(col).toHaveCSS("visibility", "hidden");

	// And so does Escape, from either side.
	await openBtn.click();
	await expect(col).toHaveCSS("visibility", "visible");
	await page.keyboard.press("Escape");
	await expect(col).toHaveCSS("visibility", "hidden");

	// A menu does not remember being open: the desktop column's hidden-or-not choice is stored, but a
	// reload must never drop an open drawer across the page and swallow the first tap.
	await openBtn.click();
	await expect(col).toHaveCSS("visibility", "visible");
	await page.reload();
	await page.locator("tt-practice .line").waitFor();
	await expect(col).toHaveCSS("visibility", "hidden");
});
