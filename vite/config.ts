import { readFileSync } from "node:fs";

export type AppConfig = { name: string; title: string; heading?: string; description: string; color: string; gateway?: true };

// Same rule as the Pages project name and the subdomain.
const NAME = /^[a-z](?:[a-z0-9-]{0,28}[a-z0-9])?$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;

export function parseConfig(raw: unknown): AppConfig {
	if (typeof raw !== "object" || raw === null) throw new Error("app.config.json: expected an object");
	const r = raw as Record<string, unknown>;
	const str = (k: string): string => {
		const v = r[k];
		if (typeof v !== "string" || v.trim() === "") throw new Error(`app.config.json: "${k}" must be a non-empty string`);
		return v;
	};
	const name = str("name");
	if (!NAME.test(name)) throw new Error(`app.config.json: "name" must match ${NAME} (got "${name}")`);
	const color = str("color");
	if (!COLOR.test(color)) throw new Error(`app.config.json: "color" must be #RRGGBB (got "${color}")`);
	if (r.gateway !== undefined && typeof r.gateway !== "boolean") throw new Error(`app.config.json: "gateway" must be true or absent`);
	// heading is the words on the page, title the words on the tab. Optional, because most apps want the
	// same string in both places and then the short one is the better label.
	if (r.heading !== undefined && (typeof r.heading !== "string" || r.heading.trim() === "")) throw new Error(`app.config.json: "heading" must be a non-empty string when present`);
	return { name, title: str("title"), ...(typeof r.heading === "string" ? { heading: r.heading } : {}), description: str("description"), color, ...(r.gateway === true ? { gateway: true as const } : {}) };
}

export function loadConfig(path: string | URL = new URL("../app.config.json", import.meta.url)): AppConfig {
	// The throw is the point: a build with a broken app.config.json must fail loudly rather than ship an
	// unnamed app. Only the read/parse is wrapped here, so the message names the file at fault.
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
	} catch (err) {
		throw new Error(`app.config.json could not be read as JSON (${path}): ${(err as Error).message}`);
	}
	return parseConfig(raw);
}
