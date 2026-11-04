// Writes lexicons/*.json from the objects the app actually uses, in the layout goat expects: the NSID
// authority reversed into directories, the last segment as the file name.
//
// This exists so the published schema and the code that writes records cannot drift apart. There is one
// source — src/atproto/lexicons.ts — and this only serialises it. `goat lex publish` then uploads these
// files, and test/lexicon-files.test.ts fails if the directory ever disagrees with the module.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { LEXICONS } from "../src/atproto/lexicons.ts";

const out = new URL("../lexicons/", import.meta.url);
// Start clean: a renamed or deleted NSID should not linger as a stale file that goat would still publish.
rmSync(out, { recursive: true, force: true });

// "app.thatsit.typing.settings" -> "lexicons/typing/thatsit/app/settings.json" (the authority reversed,
// which is the same mapping the DNS TXT record uses).
function pathFor(id: string): URL {
	const parts = id.split(".");
	const name = parts[parts.length - 1];
	if (!name) throw new Error(`lexicon id "${id}" has no name segment`);
	const dirs: string[] = [];
	for (let i = parts.length - 2; i >= 0; i -= 1) dirs.push(parts[i]);
	return new URL(`${dirs.join("/")}/${name}.json`, out);
}

for (const doc of LEXICONS) {
	if (doc.lexicon !== 1) throw new Error(`lexicon "${doc.id}" is not language version 1`);
	const p = pathFor(doc.id);
	mkdirSync(new URL(".", p), { recursive: true });
	writeFileSync(p, `${JSON.stringify(doc, null, "\t")}\n`);
	console.log(`lexicons: ${p.pathname.replace(out.pathname, "")}`);
}
