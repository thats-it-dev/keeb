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

	it(`source files stay under ${MAX_LINES} lines`, () => {
		const long = files("src", /\.ts$/)
			.map((f) => ({ f, n: read(f).split("\n").length }))
			.filter(({ n }) => n > MAX_LINES)
			.map(({ f, n }) => `${f}: ${n} lines`);
		expect(long, "split these into modules by responsibility (see AGENTS.md)").toEqual([]);
	});

	it("e2e tests do not sleep", () => {
		const sleeps = files("e2e", /\.ts$/).filter((f) => /\bwaitForTimeout\s*\(/.test(read(f)));
		expect(sleeps, "wait on a condition with expect(...).toPass() or a locator assertion instead").toEqual([]);
	});
});
