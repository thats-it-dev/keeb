// M2-M5: the practice loop. Six letters of the language from the first line, the focused key ringed on the
// board, and the key set growing as the slow keys speed up.
import type { Page } from "@playwright/test";
import { loadConfig } from "../vite/config.ts";
import { WORDS } from "../src/lesson/corpus.ts";
import { isCleanWord } from "../src/lesson/clean.ts";
import { speakable } from "../src/lesson/phonotactics.ts";
import { expect, test } from "./csp.ts";
import { keyName, openPane, paneBody } from "./keys.ts";

const cfg = loadConfig();
const heading = cfg.heading ?? cfg.title; // the h1 shows the heading; the tab shows the title

const line = (page: Page) => page.locator("tt-practice .line");
const key = (page: Page, id: string) => page.locator(`tt-keyboard g[data-id="${id}"]`);

// Wait for IndexedDB to answer, or the practice pane has no lesson yet.
const ready = async (page: Page) => {
	await expect(line(page)).toBeVisible();
	await expect(page.locator("h1")).toHaveText(heading);
	// The kit's faces are font-display: swap, so glyphs reflow when they land. A test that measures
	// text twice must not straddle that swap.
	await page.evaluate(() => document.fonts.ready);
};

const wanted = async (page: Page): Promise<string> => {
	const text = (await line(page).getAttribute("data-text")) ?? "";
	const cursor = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);
	return [...text][cursor] ?? "";
};

const tap = (page: Page, ch: string) => page.locator("tt-practice").press(keyName(ch));

const keysTyped = (page: Page) => page.evaluate(() => Object.keys((document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { stats: object } }).engine.stats).length);

// Which key a character lives on, read from the resolved board rather than from app-main's highlight
// state: a test that asks the highlight where the highlight is will always agree with it.
const idFor = (page: Page, ch: string) =>
	page.evaluate(
		(c) => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { resolved: { byChar: Map<string, string> } }).resolved.byChar.get(c) ?? "",
		ch,
	);

const cursorOf = (page: Page) =>
	page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);

// Keys the persisted record actually holds. Reading the store rather than the component is the point: the
// write behind a keystroke is async, and reload() would cut it off mid-transaction -- which is why this
// test flaked in CI on a slow runner while passing locally.
const storedKeys = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<number>((res, rej) => {
				const open = indexedDB.open("keeb");
				open.onsuccess = () => {
					const r = open.result.transaction("stats").objectStore("stats").getAll();
					r.onsuccess = () => {
						const rows = (r.result ?? []) as { value?: Record<string, unknown> }[];
						open.result.close();
						res(rows.reduce((n, row) => n + Object.keys(row.value ?? {}).length, 0));
					};
					r.onerror = () => rej(r.error);
				};
				open.onerror = () => rej(open.error);
			}),
	);

test("the first line is words the six letters can make", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const text = (await line(page).getAttribute("data-text")) ?? "";
	const words = text.split(" ");
	expect(words.length).toBeGreaterThan(6);
	expect(words.filter((w) => w.length > 2).length).toBeGreaterThan(3);
	// The default source is the letter model, not the dictionary. With six letters the corpus can spell
	// about four words, so a line of nothing but real words here would be the same four over and over.
	expect(words.some((w) => !WORDS.includes(w))).toBe(true);
});

test("the lesson is text, not a field you type into", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await expect(page.locator("tt-practice input, tt-practice textarea, tt-practice [contenteditable]")).toHaveCount(0);
	await tap(page, await wanted(page));
	await expect(page.locator("tt-practice .now")).toBeVisible(); // one underlined letter marks the target
	const marks = await page.evaluate(() => {
		const pr = document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { shadowRoot: ShadowRoot };
		return [...pr.shadowRoot.querySelectorAll(".line span")].map((s) => ({ cls: s.className, dec: getComputedStyle(s).textDecorationLine, color: getComputedStyle(s).color }));
	});
	const now = marks.find((m) => m.cls === "now");
	expect(now?.dec).toBe("underline");
	// The target carries the colour of a letter you have not reached yet. Colour reports what happened --
	// dark means hit, red means missed -- and the underline alone reports where you are. Give the target a
	// colour of its own and it sits one step ahead of your typing again.
	expect(now?.color).toBe(marks.find((m) => m.cls === "todo")?.color);
	expect(now?.color).not.toBe(marks.find((m) => m.cls === "hit")?.color);
	// A mistyped character turns red and stays red, even under the cursor.
	const ch = await wanted(page);
	await tap(page, ch === "z" ? "y" : "z");
	await expect(page.locator("tt-practice .bad")).toBeVisible();
});

test("stats sit above the line, settings start hidden", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const boxes = await page.evaluate(() => {
		const root = document.querySelector("app-main")!.shadowRoot!;
		const read = root.querySelector(".read")!.getBoundingClientRect();
		const line = root.querySelector("tt-practice")!.shadowRoot.querySelector(".line")!.getBoundingClientRect();
		return { readBottom: read.bottom, lineTop: line.top };
	});
	expect(boxes.readBottom).toBeLessThanOrEqual(boxes.lineTop); // metrics above the phrase
	await expect(page.locator("dialog")).toBeHidden(); // board/keymap behind the settings modal
	await page.locator("tk-header button[aria-label='Settings']").click();
	await expect(page.locator("dialog")).toBeVisible();
	await expect(page.locator("dialog .panel")).toBeVisible();
	await page.locator("dialog [aria-label='Close settings']").click();
	await expect(page.locator("dialog")).toBeHidden();
});

const geometry = (page: Page) =>
	page.evaluate(() => {
		const line = document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice")!.shadowRoot!.querySelector(".line")!;
		const r = line.getBoundingClientRect();
		const last = line.lastElementChild!.getBoundingClientRect();
		// Measured against the line's own left edge, so a scroll between the two samples cannot be read
		// as a layout shift.
		return { width: Math.round(r.width), end: Math.round(last.x + last.width - r.left), text: line.dataset.text };
	});

// The cursor plate must be painted out of flow. A padded span made the current letter wider than
// every other copy of it, so the whole line slid sideways on each keystroke.
test("letters stay in the same place as the cursor moves", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const before = await geometry(page);
	for (let i = 0; i < 8; i += 1) await tap(page, await wanted(page));
	const after = await geometry(page);
	expect(after.text).toBe(before.text); // the same line, so the two samples are comparable
	expect({ width: after.width, end: after.end }).toEqual({ width: before.width, end: before.end });
});

test("types a whole line and reports a plausible speed", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	for (let i = 0; i < 40; i += 1) {
		const ch = await wanted(page);
		if (ch === "") break;
		await tap(page, ch);
	}
	await expect(page.locator(".page main")).toContainText("wpm");
	const cursor = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);
	expect(cursor).toBeGreaterThan(10);
});

test("the progress bars are a pane section, not a screen to navigate to", async ({ page }) => {
	// There used to be a "Progress" button and a "Back to typing" button, and a screen between them. The
	// bars and the chart are sections of the insight panel now, so the whole navigation question is gone:
	// the keyboard stays on screen, and opening the panel is not a mode change.
	await page.goto("/");
	await ready(page);
	for (let i = 0; i < 10; i += 1) await tap(page, await wanted(page));
	await expect(page.locator("button", { hasText: "Progress" })).toHaveCount(0);
	await expect(page.locator("button", { hasText: "Back to typing" })).toHaveCount(0);
	// Closed: the section exists in the DOM but is not on screen.
	await expect(paneBody(page)).toBeHidden();
	await openPane(page);
	await expect(page.locator(".krow").first()).toBeVisible();
	await expect(page.locator(".insights > .stats")).toHaveCount(1);
	// And typing still works while the pane is out: reading your bars must not pause the lesson.
	const before = await cursorOf(page);
	await tap(page, await wanted(page));
	expect(await cursorOf(page)).toBeGreaterThan(before);
	await expect(page.locator(".krow").first()).toBeVisible(); // still there, not swapped away
});

test("the progress screen names every key it measured", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	// No sleep between keys, and none needed: press() is a full round trip to the browser, so the intervals
	// it produces are already unequal in the way a hand's are. tap() resolves after the keydown handler has
	// run, so the next wanted() reads the cursor the stroke moved.
	for (let i = 0; i < 40; i += 1) {
		const ch = await wanted(page);
		if (ch === "") break;
		await tap(page, ch);
	}
	await openPane(page);
	expect(await page.locator(".krow").count()).toBeGreaterThan(3);
	// Only keys with timing get a row. A key never struck has no bar to draw, and 40 empty rows used to
	// bury the handful that meant something; they get chips instead.
	expect(await page.locator(".chip").count()).toBeGreaterThan(0);
	const nums = await page.locator(".krow .num").allInnerTexts();
	expect(nums.every((n) => /wpm/.test(n))).toBe(true);
	// No row may render without a name. The space bar's character is a blank, so it used to arrive as an
	// invisible label on the most-struck key on the board.
	const caps = await page.locator(".krow .cap").allInnerTexts();
	expect(caps.length).toBeGreaterThan(3);
	expect(caps.every((c) => c.trim() !== "")).toBe(true);
	expect(caps).toContain("space");
	const widths = await page.locator(".krow .kbar").evaluateAll((els) => els.map((e) => parseFloat((e as HTMLElement).style.width)));
	expect(widths.every((w) => w <= 100 && w >= 2)).toBe(true);
	// Ordering is all this path can honestly claim: a scripted loop strikes every key in a millisecond or
	// two, which against the 300 ms default goal is 150-300x goal speed -- deep inside the scale's 100%
	// clamp (measured: barWidth pins at 100 below goal/3.9). Asking those rows to look different from each
	// other is a claim about the machine's clock, not about typing. test/scale.test.ts and the seeded test
	// below own the ranking.
	const pairs = widths.map((w, i) => ({ ms: Number((nums[i] ?? "").match(/(\d+)ms/)?.[1] ?? -1), w })).filter((p) => p.ms > 0);
	expect(pairs.length).toBeGreaterThan(3);
	for (const a of pairs) for (const b of pairs) if (a.ms < b.ms) expect(a.w).toBeGreaterThanOrEqual(b.w);
});

test("bar widths rank a spread of timings instead of saturating", async ({ page }) => {
	// The regression this replaces: bars scaled against the goal linearly pinned anything faster than 2x
	// goal at 100%, and the chart ranked nothing. Seeded means straddling that knee -- 40 ms to 900 ms
	// against a 300 ms goal -- are what a learner's first weeks look like, and they are the only version of
	// this claim that does not depend on how fast the runner can fire keydown events.
	await page.goto("/");
	await ready(page);
	// Key ids are positional on this board (L_C3R2), so the letters have to be resolved through the keymap
	// rather than written down as ids.
	const means: Record<string, number> = { a: 40, s: 120, d: 300, f: 460, g: 900 };
	const ids: Record<string, string> = {};
	for (const ch of Object.keys(means)) ids[ch] = await idFor(page, ch);
	expect(Object.values(ids).every((i) => i !== "")).toBe(true);

	await page.evaluate(
		([m, id]) =>
			new Promise<void>((res, rej) => {
				const db = indexedDB.open("keeb");
				db.onsuccess = () => {
					const value = Object.fromEntries(Object.entries(m).map(([ch, ms]) => [id[ch], { ttMs16: Math.round((ms as number) * 16), samples: 120, errors: 0 }]));
					const tx = db.result.transaction("stats", "readwrite");
					tx.objectStore("stats").put({ layout: "go60+qwerty", value });
					tx.oncomplete = () => {
						db.result.close();
						res();
					};
					tx.onerror = () => rej(tx.error);
				};
				db.onerror = () => rej(db.error);
			}),
		[means, ids] as [Record<string, number>, Record<string, string>],
	);
	await page.reload();
	await ready(page);
	await openPane(page);
	// The rows render only once the store has answered; reading .krow before that yields an empty list, and
	// every .every() below would then pass vacuously.
	await page.locator(".krow").first().waitFor();

	// Rows are identified by the label they show: .krow carries no id attribute, and the label is the thing a
	// learner reads next to the bar anyway.
	const rows = await page.locator(".krow").evaluateAll((els) =>
		els.map((e) => ({ cap: (e.querySelector(".cap") as HTMLElement).textContent?.trim() ?? "", w: parseFloat((e.querySelector(".kbar") as HTMLElement).style.width) })),
	);
	const byCap = new Map(rows.map((r) => [r.cap, r.w]));
	const widths = ["a", "s", "d", "g"].map((ch) => byCap.get(ch));
	expect(widths.every((w) => w !== undefined)).toBe(true);
	// Distinct: 40 ms and 120 ms are both under the goal, and a scale that saturates draws them alike.
	expect(new Set(widths).size).toBe(widths.length);
	// And strictly shorter as the key gets slower, which is the direction the bars mean.
	for (let i = 1; i < widths.length; i += 1) expect(widths[i]).toBeLessThan(widths[i - 1]!);
	// Exactly at goal sits at the midpoint, and the tick that marks it is at the same x in every row.
	expect(byCap.get("d"), "the key at exactly goal").toBe(50);
	const marks = await page.locator(".krow .mark").evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).style.left))]);
	expect(marks).toEqual(["50%"]);
	await expect(page.locator(".card").first()).toContainText("wpm");
});

test("switching keyboards cannot write the old layout's stats into the new layout's record", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	for (let i = 0; i < 6; i += 1) await tap(page, await wanted(page));
	const engineKeys = () => page.evaluate(() => Object.keys((document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { stats: object } }).engine.stats));
	const before = await engineKeys();
	expect(before.length).toBeGreaterThan(0);
	await page.locator("button[aria-label='Settings']").click();
	await page.locator("select").first().selectOption("corne");
	await ready(page);
	// Switching layouts must not leave the child lesson holding the previous board's numbers: #flushStats
	// writes whatever the engine holds under whichever layout is selected. What makes this safe is that
	// `ready` is false for the whole load, which unmounts <tt-practice> so no keystroke can land in between.
	expect((await engineKeys()).length).toBe(0);
	// And typing on the new board must not resurrect a single key from the old one.
	await tap(page, await wanted(page));
	expect((await engineKeys()).length).toBeLessThanOrEqual(1);
});

test("highlights the key the next character lives on", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await tap(page, await wanted(page));
	const id = await page.evaluate(() => (document.querySelector("app-main") as unknown as { lastId: string }).lastId);
	await expect(key(page, id)).toHaveClass(/\bon\b/);
});

test("a held key counts once, not once per auto-repeat", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const ch = await wanted(page);
	const before = await cursorOf(page);
	// What the OS actually sends while a key is down: the first keydown is fresh, the rest are repeats.
	await page.evaluate((c) => {
		for (let i = 0; i < 8; i += 1) window.dispatchEvent(new KeyboardEvent("keydown", { key: c, repeat: i > 0, bubbles: true }));
	}, ch ?? "a");
	await expect.poll(() => cursorOf(page), { timeout: 5000 }).toBe(before + 1);
	expect(await cursorOf(page)).toBe(before + 1);
	// Repeats used to charge an error to the target key, which paints the letter the learner has NOT
	// typed yet red -- the thing that reads as "the line is ahead of me".
	const misses = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { wrong: Set<number> }).wrong.size);
	expect(misses).toBe(0);
});

test("a wrong key does not move the cursor", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const before = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);
	const ch = await wanted(page);
	await tap(page, ch === "z" ? "q" : "z");
	const after = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { cursor: number }).cursor);
	expect(after).toBe(before);
	await expect(key(page, await page.evaluate(() => (document.querySelector("app-main") as unknown as { lastId: string }).lastId))).toHaveClass(/\bon\b/);
});

test("the board lights the key that was struck, not the one the lesson wanted", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const want = await wanted(page);
	const struck = want === "z" ? "q" : "z";
	expect(await idFor(page, struck)).not.toBe(await idFor(page, want)); // two different keys, or the test proves nothing
	await tap(page, struck);
	await expect(key(page, await idFor(page, struck))).toHaveClass(/\bon\b/);
	await expect(key(page, await idFor(page, want))).not.toHaveClass(/\bon\b/);
});

test("a finished line starts clean", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const text = (await line(page).getAttribute("data-text")) ?? "";
	expect(text.length).toBeGreaterThan(3);
	const want = await wanted(page);
	await tap(page, want === "z" ? "q" : "z"); // leave one red letter behind
	await expect(page.locator("tt-practice .bad")).not.toHaveCount(0);
	for (const ch of [...text]) await tap(page, ch);
	expect(await cursorOf(page)).toBe(0); // a fresh line is on screen
	await expect(page.locator("tt-practice .bad")).toHaveCount(0); // and none of its letters are red
	await expect(page.locator("tt-practice .line .now")).not.toHaveCount(0);
});

test("a single keystroke is enough to persist", async ({ page }) => {
	// The first key after a load is the interesting one: #type used to read the engine reference before
	// calling p.key(), and key() replaces the engine, so that first flush saw undefined and saved nothing.
	// Typing a whole line hid it, because the second key saved everything. One key, then reload.
	await page.goto("/");
	await ready(page);
	// The line exists a moment before the engine has placed a run in it, and wanted() answers "" for that
	// gap -- which silently skipped the keystroke and made this flake under load.
	await expect.poll(() => wanted(page), { timeout: 5000 }).not.toBe("");
	const ch = await wanted(page);
	await tap(page, ch);
	await expect.poll(() => storedKeys(page), { timeout: 5000 }).toBe(1);
	await page.reload();
	await ready(page);
	expect(await keysTyped(page)).toBe(1);
});

test("progress survives a reload", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	for (let i = 0; i < 24; i += 1) {
		const ch = await wanted(page);
		if (ch === "") break;
		await tap(page, ch);
	}
	const before = await keysTyped(page);
	expect(before).toBeGreaterThan(2);
	await expect.poll(() => storedKeys(page), { timeout: 5000 }).toBe(before);
	await page.reload();
	await ready(page);
	const after = await keysTyped(page);
	expect(after).toBe(before);
});

test("the unlocked set grows as the keys speed up", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const start = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { ladder: { unlocked: string[] } } }).engine.ladder.unlocked.length);
	// Practise at the goal pace, so every key should clear it.
	for (let i = 0; i < 900; i += 1) {
		const ch = await wanted(page);
		if (ch === "") break;
		await tap(page, ch);
	}
	const now = await page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { ladder: { unlocked: string[] } } }).engine.ladder.unlocked.length);
	expect(now).toBeGreaterThan(start);
});

// ---------------------------------------------------------------------------
// The keybr-shaped curriculum: six letters, one focus, and unlocks that read the best a key has ever done.

/** The ladder as the running page sees it: which letters are in play, and which one the line is about. */
const curriculum = (page: Page) =>
	page.evaluate(() => {
		const pr = document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as {
			engine: { ladder: { unlocked: string[]; focus?: string; next?: string } };
			resolved: { byId: Map<string, { char: string }> };
		};
		const char = (id: string) => pr.resolved.byId.get(id)?.char ?? "?";
		return { unlocked: pr.engine.ladder.unlocked.map(char), focus: pr.engine.ladder.focus === undefined ? null : char(pr.engine.ladder.focus), next: pr.engine.ladder.next === undefined ? null : char(pr.engine.ladder.next) };
	});

/** Put the store on a point of the ladder, so a test does not have to type its way there at 200 wpm. */
const seedSpeed = (page: Page, msById: Record<string, number>) =>
	page.evaluate(
		(entries) =>
			new Promise<void>((res, rej) => {
				const open = indexedDB.open("keeb");
				open.onsuccess = () => {
					const value = Object.fromEntries(
						Object.entries(entries).map(([id, ms]) => [id, { ttMs16: Math.round((ms as number) * 16), bestMs16: Math.round((ms as number) * 16), samples: 120, errors: 0 }]),
					);
					const tx = open.result.transaction("stats", "readwrite");
					tx.objectStore("stats").put({ layout: "go60+qwerty", value });
					tx.oncomplete = () => {
						open.result.close();
						res();
					};
					tx.onerror = () => rej(tx.error);
				};
				open.onerror = () => rej(open.error);
			}),
		msById,
	);

/** The teaching order as the running page derived it, so a test can say "the first fifteen letters". */
const ladderOrder = (page: Page) =>
	page.evaluate(() => (document.querySelector("app-main")!.shadowRoot!.querySelector("tt-practice") as unknown as { engine: { ladder: { order: string[] } } }).engine.ladder.order);

/** Tick a settings checkbox by its label, and wait for the page to act on it. */
const setToggle = async (page: Page, label: string, on: boolean) => {
	await page.getByRole("button", { name: "Settings" }).click();
	const box = page.locator("dialog").getByLabel(label, { exact: false });
	if ((await box.isChecked()) !== on) await box.click();
	await page.locator("dialog [aria-label='Close settings']").click();
};

test("the first line is built from six letters, and every word carries one of them", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const { unlocked, focus } = await curriculum(page);
	expect(unlocked.length).toBe(6);
	const words = ((await line(page).getAttribute("data-text")) ?? "").split(" ");
	for (const w of words) for (const ch of w) expect(unlocked, `${ch} in ${w}`).toContain(ch);
	// The focus is not a caption on the lesson; it is inside every word of it.
	expect(focus).toBeTruthy();
	expect(words.every((w) => w.includes(focus as string))).toBe(true);
});

test("a line further up the ladder carries the focused letter and reads as English", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	// Sixteen letters, the newest one untouched: the point where the line used to come apart, because the
	// letters that had never been typed were patched in by replacing the words that did carry the focus.
	const order = await ladderOrder(page);
	const msById: Record<string, number> = {};
	for (const id of order.slice(0, 15)) msById[id] = 200;
	await seedSpeed(page, msById);
	await page.reload();
	await ready(page);
	const { unlocked, focus } = await curriculum(page);
	expect(unlocked.length).toBe(16);
	expect(focus).toBeTruthy();
	const words = ((await line(page).getAttribute("data-text")) ?? "").split(" ");
	expect(words.length).toBeGreaterThan(5);
	for (const w of words) {
		expect(w, `no ${focus} in ${w}`).toContain(focus as string);
		expect(speakable(w) && isCleanWord(w), w).toBe(true);
	}
});

test("the key the lesson is built around is ringed on the board and named on screen", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const { focus } = await curriculum(page);
	const id = await idFor(page, focus as string);
	// A shape, not a colour: the board already spends fill on "you just hit this" and red on "you missed".
	await expect(page.locator(`tt-keyboard g[data-id=\"${id}\"] rect.ring`)).toHaveCount(1);
	await expect(page.locator("tt-keyboard g rect.ring")).toHaveCount(1);
	await expect(page.locator(".read .metric", { hasText: "focus" })).toContainText(focus as string, { ignoreCase: true });
});

test("the focus moves to the letter that has never been typed", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	const before = await curriculum(page);
	// Reach the goal on every letter in play, at a pace the EWMA will believe.
	for (let i = 0; i < 400; i += 1) {
		const ch = await wanted(page); // a round trip, which is the pacing this test needs
		if (ch === "") break;
		await tap(page, ch);
	}
	const after = await curriculum(page);
	expect(after.unlocked.length).toBeGreaterThanOrEqual(before.unlocked.length);
	if (after.unlocked.length > before.unlocked.length) {
		// The newest letter is the weakest thing on the board, so the ring belongs on it.
		expect(after.focus).toBe(after.unlocked[after.unlocked.length - 1]);
	}
});

test("real words are a setting, and it survives a reload", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await setToggle(page, "use real words", true);
	const words = ((await line(page).getAttribute("data-text")) ?? "").split(" ");
	// The pool of real words spelled with the first six letters is thin, so the line is allowed to top
	// itself up from the model -- but the corpus has to be doing most of the work.
	expect(words.filter((w) => WORDS.includes(w)).length).toBeGreaterThanOrEqual(words.length / 2);
	await page.reload();
	await ready(page);
	await page.getByRole("button", { name: "Settings" }).click();
	await expect(page.locator("dialog").getByLabel("use real words", { exact: false })).toBeChecked();
});

test("keyboard order starts on the home row instead of the language's six", async ({ page }) => {
	await page.goto("/");
	await ready(page);
	await setToggle(page, "teach in keyboard order", true);
	const { unlocked } = await curriculum(page);
	expect(unlocked.length).toBe(6);
	// QWERTY home row, both hands: a s d f g ; h j k l. Six of these, and nothing from the top row.
	const home = new Set("asdfghjkl;".split(""));
	expect(unlocked.every((ch) => home.has(ch))).toBe(true);
});
