import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../vite/config.ts";

const root = new URL("../", import.meta.url);
const dist = (p: string) => readFileSync(new URL(`dist/${p}`, root), "utf8");

beforeAll(() => {
	execFileSync("npx", ["vite", "build"], { cwd: root, stdio: "pipe" });
}, 60_000);

describe("vite build", () => {
	it("emits a manifest named by title, labelled short by heading", () => {
		const m = JSON.parse(dist("manifest.webmanifest")) as { name: string; short_name: string };
		const c = loadConfig();
		// name is the app's full name; short_name is the wordmark a launcher shows under the icon.
		expect(m.name).toBe(c.title);
		expect(m.short_name).toBe(c.heading ?? c.title);
	});

	it("fills in index.html", () => {
		const html = dist("index.html");
		expect(html).not.toContain("%APP_");
		expect(html).not.toContain("__APPLE_TOUCH_ICON__");
		expect(html).toContain("data:image/png;base64,");
		expect(html).toContain("https://kit.thatsit.app/kit.css");
		expect(html).toContain('src="https://kit.thatsit.app/theme-init.js"');
		expect(html).toContain('data-key="app:theme"');
	});

	it("puts the full name in the tab and the wordmark in the short labels", () => {
		// The distinction exists because the two get truncated in opposite ways: a tab shows the name in
		// full, a launcher tile cuts it at about a dozen characters. Swapping them reads as a bug.
		const c = loadConfig();
		const html = dist("index.html");
		expect(html).toContain(`<title>${c.title}</title>`);
		expect(html).toContain(`<meta name="apple-mobile-web-app-title" content="${c.heading ?? c.title}"`);
		if (c.heading !== undefined) expect(html).not.toContain(`<meta name="apple-mobile-web-app-title" content="${c.title}"`);
	});

	it("does not bundle a second Lit", () => {
		const dir = new URL("dist/assets/", root);
		for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
			const js = readFileSync(new URL(f, dir), "utf8");
			expect(js).not.toContain("lit-html");
			expect(js).not.toContain("LitElement.prototype");
		}
	});

	it("fills in the service worker", () => {
		const sw = dist("sw.js");
		expect(sw).not.toContain("__PRECACHE__");
		expect(sw).not.toContain("__VERSION__");
		expect(sw).toMatch(/app-\$\{"[0-9a-f]{10}"\}/);
		const files = readdirSync(new URL("dist/assets/", root));
		expect(files.length).toBeGreaterThan(0);
		for (const f of files) expect(sw).toContain(`"/assets/${f}"`);
	});
});
