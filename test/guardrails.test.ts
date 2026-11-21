// Checks on the repo itself rather than on app behaviour. They run with `npm test`, so an agent meets them
// on every local run, not only in CI. AGENTS.md explains each rule.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const MAX_LINES = 400;

function files(dir: string, ext: RegExp): string[] {
	return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile() && ext.test(e.name))
		.map((e) => relative(root, join(e.parentPath, e.name)));
}

const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("guardrails", () => {
	it("package.json name matches app.config.json name", () => {
		const pkg = JSON.parse(read("package.json")).name;
		const app = JSON.parse(read("app.config.json")).name;
		expect(pkg, "set package.json (and package-lock.json) name to the app name").toBe(app);
	});

	it("docs/spec.md is written, not the starter", () => {
		if (JSON.parse(read("package.json")).name === "app-template") return;
		let spec = "";
		try {
			spec = read("docs/spec.md");
		} catch {}
		expect(spec, "write docs/spec.md (see AGENTS.md, Spec)").not.toBe("");
		expect(spec.includes("starter spec:"), "docs/spec.md is still the starter: replace every section from Michael's request").toBe(false);
	});

	it(`source files stay under ${MAX_LINES} lines`, () => {
		const long = files("src", /\.ts$/)
			.map((f) => ({ f, n: read(f).split("\n").length }))
			.filter(({ n }) => n > MAX_LINES)
			.map(({ f, n }) => `${f}: ${n} lines, ${n - MAX_LINES} over`);
		expect(long, "split these into modules by responsibility (see AGENTS.md)").toEqual([]);
	});

	it("CI's Playwright image matches the @playwright/test version", () => {
		const want = JSON.parse(read("package.json")).devDependencies?.["@playwright/test"];
		const image = /mcr\.microsoft\.com\/playwright:v([\d.]+)-/.exec(read(".github/workflows/deploy.yml"))?.[1];
		expect(image, "set the container tag in .github/workflows/deploy.yml to v<@playwright/test version>-noble").toBe(want);
	});

	// Styles may only use tokens the kit defines (AGENTS.md lists them). A made-up name such as --tk-accent-fill
	// resolves to nothing, so the element renders without colour, border or fill, and no test sees it.
	it("CSS custom properties come from the kit", () => {
		let kitCss = "";
		try {
			kitCss = read(".kit/kit.css");
		} catch {}
		expect(kitCss, "run `npm run kit-types` first; it fetches the kit's stylesheet into .kit/").not.toBe("");
		const kit = new Set([...kitCss.matchAll(/--([A-Za-z][\w-]*)\s*:/g)].map((m) => m[1]));
		const sources = [...files("src", /\.(?:ts|js|css|html)$/), "index.html"];
		const unknown: string[] = [];
		for (const f of sources) {
			const text = read(f);
			// A property the app sets itself (e.g. `--cols: 4` on a grid) may be read in the same app.
			const own = new Set([...text.matchAll(/--([A-Za-z][\w-]*)\s*:/g)].map((m) => m[1]));
			for (const m of text.matchAll(/var\(\s*--([A-Za-z][\w-]*)/g)) {
				if (!kit.has(m[1]) && !own.has(m[1])) unknown.push(`${f}: --${m[1]}`);
			}
		}
		const colours = [...kit].filter((t) => !/^(?:font|safe|sidebar|aside|radius)/.test(t)).map((t) => `--${t}`).join(", ");
		expect([...new Set(unknown)], `the kit defines no such token (AGENTS.md, Styling); colours are ${colours}; shape and type are --radius, --font-body, --font-display, --font-mono`).toEqual([]);
	});

	it("e2e tests do not sleep", () => {
		const sleeps = files("e2e", /\.ts$/).filter((f) => /\bwaitForTimeout\s*\(/.test(read(f)));
		expect(sleeps, "wait on a condition with expect(...).toPass() or a locator assertion instead").toEqual([]);
	});
});
