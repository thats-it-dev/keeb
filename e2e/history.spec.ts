// M5: the practice history. Sessions live on the PDS and are cached in IndexedDB, so these tests seed
// the cache directly -- signing in from a browser test would need a real account and a real PKCE dance.
import type { Page } from "@playwright/test";
import { expect, test } from "./csp.ts";

type Row = { rkey: string; layout: string; atMs: number; chars: number; errors: number; ms: number };

const noon = (daysAgo: number) => {
	const d = new Date();
	d.setDate(d.getDate() - daysAgo);
	d.setHours(12, 0, 0, 0);
	return d.getTime();
};

const row = (over: Partial<Row> & { rkey: string; atMs: number }): Row => ({ layout: "go60+qwerty", chars: 500, errors: 4, ms: 60_000, ...over });

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
	await page.locator("button", { hasText: "Progress" }).click();
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
