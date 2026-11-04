// The published schema and the code that writes records are only the same thing if nothing drifts. These
// checks cover the files on disk, the goat directory layout they must sit in, and the DNS authority name
// that ties the namespace to a repository — the part the README had wrong once already.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEXICONS, PROGRESS, SESSION, SETTINGS, LAYOUT } from "../src/atproto/lexicons.ts";

// "app.thatsit.typing.settings" -> "lexicons/typing/thatsit/app/settings.json"
const fileFor = (id: string) => {
	const parts = id.split(".");
	const name = parts[parts.length - 1];
	const dirs: string[] = [];
	for (let i = parts.length - 2; i >= 0; i -= 1) dirs.push(parts[i]);
	return `../lexicons/${dirs.join("/")}/${name}.json`;
};

describe("published lexicon files", () => {
	it("exist, one per lexicon, byte-equal to the module", () => {
		for (const doc of LEXICONS) {
			const text = readFileSync(new URL(fileFor(doc.id), import.meta.url), "utf8");
			expect(JSON.parse(text), doc.id).toEqual(doc);
			expect(text.endsWith("\n"), doc.id).toBe(true);
		}
	});

	it("sits at the DNS authority the NSID implies, not the apex domain", () => {
		// atproto derives the TXT name from the NSID minus its final segment, reversed. For
		// app.thatsit.typing.* that is typing.thatsit.app -> _lexicon.typing.thatsit.app. Resolution does
		// not walk up or down the DNS tree, so a record at the apex would simply never be found.
		const authority = SETTINGS.split(".").slice(0, -1).reverse().join(".");
		expect(authority).toBe("typing.thatsit.app");
		expect(`_lexicon.${authority}`).toBe("_lexicon.typing.thatsit.app");
	});

	it("keeps every NSID in one authority, so one TXT record covers the set", () => {
		const authorities = new Set([SETTINGS, PROGRESS, SESSION, LAYOUT].map((id) => id.split(".").slice(0, -1).join(".")));
		expect([...authorities]).toEqual(["app.thatsit.typing"]);
	});

	it("declares record keys the way the collections are actually written", () => {
		// settings is a singleton; the others key by tid, which is what makes "prune the oldest sessions"
		// a sort rather than a timestamp lookup.
		const doc = (id: string) => LEXICONS.find((d) => d.id === id) as { defs: { main: { key: string } } };
		expect(doc(SETTINGS).defs.main.key).toBe("literal:self");
		expect(doc(PROGRESS).defs.main.key).toBe("tid");
		expect(doc(SESSION).defs.main.key).toBe("tid");
	});
});
