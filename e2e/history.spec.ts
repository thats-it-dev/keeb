// M5: the practice history. Sessions live on the PDS and are cached in IndexedDB, so these tests seed
// the cache directly -- signing in from a browser test would need a real account and a real PKCE dance.
import type { Page } from "@playwright/test";
import { expect, test } from "./csp.ts";

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

// Fold the pane out, whichever shape it took. On a desktop the rail is the button; on a phone the whole pane
// sits off-canvas, so its rail is not clickable and the header button is the opener.
const openPane = async (page: Page) => {
	const rail = page.locator("tt-insight-panel .bar");
	if (await rail.isVisible()) await rail.click();
	else await page.locator("app-main .head button[aria-label=\"Insights\"]").click();
	await expect(page.locator("tt-insight-panel .body")).toBeVisible();
};

// The app reads the cache once, on boot, so seed first and then load.
const seedAndOpen = async (page: Page, rows: Row[]) => {
	await page.goto("/");
	await expect(page.locator("tt-practice .line")).toBeVisible(); // the app has opened the database by now
	await seed(page, rows);
	await page.reload();
	await expect(page.locator("tt-practice .line")).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	await page.locator("button", { hasText: "Progress" }).click();
	// The history is a section of the insight pane now, and the pane arrives folded.
	await openPane(page);
};

test("cached sessions draw a curve and honest totals", async ({ page }) => {
	await seedAndOpen(page, [
		row({ rkey: "aaa", atMs: noon(0), chars: 400, ms: 60_000 }),
		row({ rkey: "aab", atMs: noon(1), chars: 500, errors: 20, ms: 60_000 }),
		row({ rkey: "aac", atMs: noon(2), chars: 600, ms: 120_000 }),
	]);
	await expect(page.locator(".hist")).toBeVisible();
	expect(await page.locator(".hist .chart circle").count()).toBe(3);
	await expect(page.locator(".hist .chart .goal")).toHaveCount(1);
	const card = (name: string) => page.locator(".hist .card", { hasText: name }).locator("b");
	await expect(card("characters")).toHaveText("1500"); // 400 + 500 + 600, a real stroke count
	await expect(card("sessions")).toHaveText("3");
	await expect(card("practised")).toHaveText("4 min");
	await expect(card("streak")).toHaveText("3 d");
});

test("a day with no sessions is a gap, not a point on a line", async ({ page }) => {
	await seedAndOpen(page, [row({ rkey: "b1", atMs: noon(0) }), row({ rkey: "b2", atMs: noon(1) }), row({ rkey: "b3", atMs: noon(2) }), row({ rkey: "b4", atMs: noon(6) })]);
	const xs = await page.locator(".hist .chart circle").evaluateAll((els) => els.map((e) => Number(e.getAttribute("cx"))));
	expect(xs.length).toBe(4); // four days practised out of seven
	// A ratio, not pixels: the chart's geometry is allowed to change (it just did, twice) and this is the
	// claim that must survive it. Three consecutive days sit one slot apart, and the day after the three-day
	// hole is four slots along. Ordering is not assumed -- only the gap sizes are.
	const gaps = xs.slice(1).map((x, i) => x - xs[i]!).filter((g) => g > 0);
	const one = Math.min(...gaps);
	expect(one).toBeGreaterThan(0);
	expect(Math.max(...gaps) / one).toBeCloseTo(4, 0);
	// And the line itself must break, not slope: two subpaths (two M commands) for two runs of practice.
	// A single continuous path here would claim a decline across days nobody was at the keyboard.
	const d = (await page.locator(".hist .chart path.trend").getAttribute("d")) ?? "";
	expect(d.split("M").length - 1).toBe(2);
	await expect(page.locator(".hist .card", { hasText: "streak" }).locator("b")).toHaveText("3 d");
});

test("history from another board does not leak into this one's chart", async ({ page }) => {
	await seedAndOpen(page, [
		row({ rkey: "c1", atMs: noon(0), layout: "corne+colemak_dh", chars: 900 }),
		row({ rkey: "c2", atMs: noon(1), layout: "corne+colemak_dh", chars: 900 }),
	]);
	// Speed on a Corne says nothing about the same fingers on a Go60, so the section is simply absent.
	await expect(page.locator(".hist")).toHaveCount(0);
	// The progress pane is still there and still talking about this board -- the history was filtered out,
	// not the screen. Nothing has been typed locally, so it shows the "hit a key first" state.
	await expect(page.locator(".stats h2")).toContainText("progress");
	await expect(page.locator(".stats")).toContainText("A key gets a bar");
});

test("a session with no readable date counts, but is not drawn", async ({ page }) => {
	await seedAndOpen(page, [row({ rkey: "d1", atMs: 0, chars: 700, ms: 60_000 }), row({ rkey: "d2", atMs: noon(0), chars: 300, ms: 60_000 })]);
	expect(await page.locator(".hist .chart circle").count()).toBe(1); // the undated one is in the totals only
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
	await page.locator("button", { hasText: "Progress" }).click();
	await expect(page.locator(".hist")).toHaveCount(0);
	// The key-progress part of the pane still works offline.
	await expect(page.locator(".stats h2")).toContainText("progress");
});

test("?demo=1 draws a labelled curve and stores nothing", async ({ page }) => {
	await page.goto("/?demo=1");
	await expect(page.locator("tt-practice .line")).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	await page.locator("button", { hasText: "Progress" }).click();
	// The demo prompt lives in the history section, which lives in the pane. On a real branch preview the pane
	// starts open; this is localhost, so the test folds it out by hand.
	await openPane(page);
	await expect(page.locator(".demo-note")).toContainText("demo sessions");
	await expect(page.locator(".demo-note")).toContainText("nothing here is your progress");
	expect(await page.locator(".hist .chart circle").count()).toBeGreaterThan(5);
	expect(await page.locator(".hist .chart path.trend").getAttribute("d")).toContain("M");
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
	await page.locator("button", { hasText: "Progress" }).click();
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
	await page.locator("button", { hasText: "Progress" }).click();

	const paths = await page.locator(".chart").evaluate((svg) => {
		const d = (sel: string) => svg.querySelector(sel)?.getAttribute("d") ?? "";
		return { trend: d(".trend"), typing: d(".typing"), gap: d(".gap") };
	});
	expect(paths.trend).not.toBe("");
	// Two separate lines: the clock speed, and the same characters over the stroke time alone.
	expect(paths.typing).not.toBe("");
	expect(paths.typing).not.toBe(paths.trend);
	// A higher wpm is a smaller y in SVG space, so every point of the typing line sits ABOVE the clock line
	// on the same day, and the band between them is the time that was not spent typing.
	expect(paths.gap).not.toBe("");
	expect(paths.typing.split("L").length).toBe(4); // one run, four consecutive days
	const ys = (d: string) => [...d.matchAll(/([\d.]+),([\d.]+)/g)].map((m) => Number(m[2]));
	const clockY = ys(paths.trend);
	const typingY = ys(paths.typing);
	expect(typingY).toHaveLength(clockY.length);
	typingY.forEach((y, i) => expect(y, `day ${i}`).toBeLessThan(clockY[i]!));

	// Now the same days with the per-key snapshot removed. Records written before stats existed look like
	// this, and the honest chart draws one line and no band -- not a band filled all the way to the axis,
	// which would read as "every second of this session was spent hesitating".
	await seed(page, rows.map((r) => ({ ...r, stats: {} })));
	await page.reload();
	await page.locator("button", { hasText: "Progress" }).click();
	const bare = await page.locator(".chart").evaluate((svg) => ({
		trend: svg.querySelector(".trend")?.getAttribute("d") ?? "",
		typing: svg.querySelector(".typing")?.getAttribute("d") ?? "",
		gap: svg.querySelector(".gap")?.getAttribute("d") ?? "",
	}));
	expect(bare.trend).not.toBe("");
	expect(bare.typing).toBe("");
	expect(bare.gap).toBe("");
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
	await page.locator("button", { hasText: "Progress" }).click();

	const panel = page.locator("tt-insight-panel");
	await expect(panel).toBeVisible();
	// Closed: the cards exist in the DOM but are hidden, so opening costs no re-render of the chart.
	// Scoped to .body, which is where the panel's own cards are: the slotted history section is a child of the
	// host in the DOM tree, not of .body, so naming .card bare would also count the five history totals.
	await expect(panel.locator(".body .card")).toHaveCount(3);
	await expect(panel.locator(".body")).toBeHidden();
	await expect(panel.locator(".bar")).toHaveAttribute("aria-expanded", "false");

	await panel.locator(".bar").click();
	await expect(panel.locator(".body")).toBeVisible();
	await expect(panel.locator(".bar")).toHaveAttribute("aria-expanded", "true");
	// The hesitation card is the reason the panel exists, so it must carry a number, not just prose.
	await expect(panel.locator('[data-id="hesitation"] .big')).toContainText("wpm");

	await page.reload();
	await page.locator("button", { hasText: "Progress" }).click();
	await expect(page.locator("tt-insight-panel .body")).toBeVisible(); // remembered, without a click
});

test("an empty panel explains itself instead of showing three blank cards", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "phone", "the desktop column path; the drawer has its own test");
	await page.goto("/");
	await page.locator("tt-practice .line").waitFor();
	await seed(page, [row({ rkey: "solo", atMs: noon(0), stats: {} })]);
	await page.reload();
	await page.locator("button", { hasText: "Progress" }).click();
	const panel = page.locator("tt-insight-panel");
	await panel.locator(".bar").click();
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
	await page.locator("button", { hasText: "Progress" }).click();
	const panel = page.locator("tt-insight-panel");
	await expect(panel.locator(".body")).toBeHidden();
	await expect(panel.locator(".body")).toHaveAttribute("inert");
	// Tab from the top of the screen: the toggle is reachable, the cards inside it are not. One focus() on a
	// card is the whole claim -- inert makes focus() a no-op, so activeElement stays where it was.
	const toggle = page.locator("tt-insight-panel .bar");
	await toggle.focus();
	await expect(toggle).toBeFocused();
	await page.locator("tt-insight-panel .body .card").first().evaluate((el) => (el as HTMLElement).focus());
	await expect(toggle).toBeFocused();
	await expect(page.locator("tt-insight-panel .body .card").first()).not.toBeFocused();
});

test("the panel comes back the way you left it after a reload", async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === "phone", "the desktop column path; the drawer has its own test");
	await page.goto("/");
	await page.locator("tt-practice .line").waitFor();
	await seed(page, [row({ rkey: "one", atMs: noon(0) })]);
	await page.reload();
	await page.locator("button", { hasText: "Progress" }).click();
	const panel = page.locator("tt-insight-panel");
	await expect(panel.locator(".body")).toBeHidden();

	// Open it, then reload: the state must survive without a click.
	await panel.locator(".bar").click();
	await expect(panel.locator(".body")).toBeVisible();
	await page.reload();
	await page.locator("button", { hasText: "Progress" }).click();
	await expect(page.locator("tt-insight-panel .body")).toBeVisible();
	await expect(page.locator("tt-insight-panel .bar")).toHaveAttribute("aria-expanded", "true");

	// Close it, then reload again. This is the half that a presence-based attribute gets wrong: storage holds
	// "0", and reading that as "anything present means open" would silently reopen the panel forever.
	await page.locator("tt-insight-panel .bar").click();
	await expect(page.locator("tt-insight-panel .body")).toBeHidden();
	await page.reload();
	await page.locator("button", { hasText: "Progress" }).click();
	await expect(page.locator("tt-insight-panel .body")).toBeHidden();
	await expect(page.locator("tt-insight-panel .bar")).toHaveAttribute("aria-expanded", "false");
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
	await page.locator("button", { hasText: "Progress" }).click();
	const panel = page.locator("tt-insight-panel");
	const vp = page.viewportSize()!;

	// It belongs to the shell: pinned to the viewport, flush with the right edge, top to bottom.
	await expect(panel).toHaveCSS("position", "fixed");
	const box = await panel.boundingBox();
	expect(Math.round(box!.y)).toBe(0);
	expect(Math.round(box!.height)).toBe(vp.height);
	expect(Math.round(box!.x + box!.width)).toBe(vp.width);

	// Flat: no rounded corners anywhere, and the only edge treatment is the one rule facing the content.
	await expect(panel).toHaveCSS("border-top-left-radius", "0px");
	await expect(panel).toHaveCSS("border-top-width", "0px");
	await expect(panel).toHaveCSS("border-right-width", "0px");
	await expect(panel).toHaveCSS("border-bottom-width", "0px");
	await expect(panel).toHaveCSS("border-left-width", "1px");

	const closed = await panel.boundingBox();
	const hostPad = await page.locator("app-main").evaluate((el) => getComputedStyle(el).paddingRight);
	expect(hostPad).toBe("36px"); // the document steps aside by the rail's width

	await panel.locator(".bar").click();
	await expect(panel.locator(".body")).toBeVisible();
	// The settled width, not a frame of the transition.
	await expect(panel).toHaveCSS("width", "304px");
	const open = await panel.boundingBox();
	expect(Math.round(open!.height)).toBe(vp.height); // opening sideways: never taller
	expect(Math.abs(open!.x - (vp.width - 304))).toBeLessThanOrEqual(1);
	await expect(page.locator("app-main")).toHaveCSS("padding-right", "304px");

	// The cards scroll inside the column rather than extending the page.
	expect(await panel.locator(".body").evaluate((el) => el.scrollHeight >= el.clientHeight)).toBe(true);

	// And the history is a section of THIS pane, not of the progress screen. The chart's nodes are children of
	// the host, distributed into .body by the slot, so the claim is checkable from the DOM tree: the section is
	// under tt-insight-panel and there is none left in .stats.
	expect(await page.locator("tt-insight-panel > .hist .chart").count()).toBe(1);
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

	const panel = page.locator("tt-insight-panel");
	const vp = page.viewportSize()!;
	// Closed and off-canvas: parked past the right edge, and out of the tab order, which visibility:hidden is
	// what buys -- a translate alone would leave its buttons focusable.
	await expect(panel).toHaveCSS("visibility", "hidden");
	expect(Math.round((await panel.boundingBox())!.x)).toBeGreaterThanOrEqual(vp.width - 1);
	// Nothing is reserved on a phone: the page keeps its full width and the drawer covers it.
	await expect(page.locator("app-main")).toHaveCSS("padding-right", "0px");

	// The rail is gone, so the header carries the only opener.
	const openBtn = page.locator(".drawer-only");
	await expect(openBtn).toBeVisible();
	await openBtn.click();
	await expect(panel).toHaveCSS("visibility", "visible");
	await expect(panel.locator(".body")).toBeVisible();
	// Wait for the slide to finish: transform animates over 0.25s, and a box measured mid-flight reports the
	// pane still parked off-screen. (The width assertion caught this; the same trap cost a 58px reading once
	// already on the desktop column.)
	await expect(panel).toHaveCSS("transform", "none");
	const box = await panel.boundingBox();
	expect(box!.width).toBeGreaterThan(200); // min(85vw, 20rem), not a 36px rail
	expect(Math.round(box!.x + box!.width)).toBe(vp.width);

	// The scrim dismisses it, which is the gesture a side menu is expected to answer.
	await page.locator(".scrim").click({ position: { x: 20, y: 300 } });
	await expect(panel).toHaveCSS("visibility", "hidden");

	// And so does Escape, from either side.
	await openBtn.click();
	await expect(panel).toHaveCSS("visibility", "visible");
	await page.keyboard.press("Escape");
	await expect(panel).toHaveCSS("visibility", "hidden");

	// A menu does not remember being a menu open: the desktop column's folded-or-not choice is stored, but a
	// reload must never drop an open drawer across the page and swallow the first tap. (This is the case the
	// history section exposed -- the stored flag used to restore the drawer open here.)
	await openBtn.click();
	await page.reload();
	await page.locator("tt-practice .line").waitFor();
	await expect(panel).toHaveCSS("visibility", "hidden");
});
