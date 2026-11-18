import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Rebuilds src/lesson/symbols.ts: how often each non-letter, typeable character appears in written
// English. The lesson's teaching order uses this for the characters that a keymap layer contributes —
// the word corpus (scripts/make-corpus.ts) is plain lowercase letters, so without a table of its own
// the ladder would rank `,` and `.` by their code point, behind `{`.
//
// Source: public Wikipedia article extracts (explaintext, CC BY-SA 4.0). The page list mixes dialogue
// heavy literature (quotes, exclamations, question marks), mathematics and computing (brackets,
// operators), and dates-and-currency prose (digits, hyphens), because no single genre prints every
// keyboard symbol honestly. Fetch is build-time only; the shipped app carries just the order.
//
// Usage: npx tsx scripts/make-symbols.ts [outPath]

const PAGES: string[] = [
	// Literature: dialogue carries " ! ? , and the apostrophe.
	"Pride and Prejudice", "Moby-Dick", "Frankenstein", "The Adventures of Sherlock Holmes",
	"Alice's Adventures in Wonderland", "Dracula", "The Great Gatsby", "Jane Eyre",
	"Wuthering Heights", "A Tale of Two Cities", "David Copperfield", "The Scarlet Letter",
	"Treasure Island", "The Time Machine", "The War of the Worlds", "Heart of Darkness",
	"The Adventures of Tom Sawyer", "A Christmas Carol", "The Yellow Wallpaper", "The Awakening",
	// Plays and verse: brackets, dashes, ellipses.
	"Hamlet", "Romeo and Juliet", "Macbeth",
	// Mathematics and computing: operators, brackets, braces, percent, equals.
	"Mathematics", "Prime number", "Pythagorean theorem", "Statistics", "Probability theory",
	"Algorithm", "Programming language", "Regular expression", "Chess",
	// Applied everyday text: currency, email, URLs, digits and dates.
	"Periodic table", "Email", "Telephone", "ISBN", "Unicode", "Percent",
	"United Kingdom", "World War II", "French Revolution", "Music", "Piano", "Currency",
];

/** What a keyboard actually delivers, minus letters and space. Everything else is excluded from the
 *  table: accented letters are letters, and nothing a keycap names as a control word has a printed form
 *  to count. */
const COUNTED = /[!-/:-@[-`{-~0-9]/;

/** Curly and long forms normalize to the character the learner's fingers actually strike. */
const NORMALIZE: ReadonlyMap<string, string> = new Map([
	["\u201C", '"'], ["\u201D", '"'], ["\u201E", '"'], ["\u201F", '"'], ["\u00AB", '"'], ["\u00BB", '"'],
	["\u2018", "'"], ["\u2019", "'"], ["\u201A", "'"], ["\u02BC", "'"], ["\u00B4", "'"],
	["\u2013", "-"], ["\u2014", "-"], ["\u2212", "-"], ["\u2010", "-"], ["\u2011", "-"],
	["\u2026", "."], // one ellipsis counts as one dot, not three: it is one thought
	["\u00A0", " "], ["\u202F", " "], ["\u2009", " "],
]);

async function extracts(titles: string[]): Promise<string[]> {
	const out: string[] = [];
	for (const title of titles) {
		// One title per call: prop=extracts with explaintext only carries real content for a single page
		// per request — batched titles come back as placeholders, which once quietly made the whole table
		// one article's punctuation.
		let url: URL;
		try {
			url = new URL("https://en.wikipedia.org/w/api.php");
			url.search = new URLSearchParams({
				action: "query", prop: "extracts", explaintext: "1", characters: "1000000",
				format: "json", formatversion: "2", redirects: "1", titles: title,
			}).toString();
		} catch {
			throw new Error("could not build the wikipedia request URL");
		}
		const res = await fetchWithRetry(url, title);
		if (!res.ok) throw new Error(`wikipedia responded ${res.status} for ${title}`);
		const body = (await res.json()) as { query?: { pages?: { extract?: string }[] } };
		out.push((body.query?.pages ?? []).map((p) => p.extract ?? "").join(""));
		await sleep(700); // be polite: this is one shared API and 44 pulls in a row
	}
	return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url: URL, title: string, attempt = 0): Promise<Response> {
	const res = await fetch(url, { headers: { "User-Agent": "keeb-lesson-corpus-builder/1.0 (typing-practice data; build-time only)" } });
	if (res.status === 429 && attempt < 5) {
		const wait = Number(res.headers.get("retry-after") ?? 0) * 1000 || 2000 * (attempt + 1);
		console.log(`  429 for ${title}, waiting ${(wait / 1000).toFixed(0)}s`);
		await sleep(wait);
		return fetchWithRetry(url, title, attempt + 1);
	}
	return res;
}

const counts = new Map<string, number>();
for (let i = 0; i < PAGES.length; i += 8) {
	const batch = PAGES.slice(i, i + 8);
	console.log(`fetching ${batch.length} articles (${i}+ of ${PAGES.length})`);
	for (const text of await extracts(batch)) {
		for (const raw of text) {
			const ch = NORMALIZE.get(raw) ?? raw;
			if (COUNTED.test(ch) && ch.charCodeAt(0) < 128) counts.set(ch, (counts.get(ch) ?? 0) + 1);
		}
	}
}

const order = [...counts.entries()]
	.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
	.map(([ch]) => ch);

const total = [...counts.values()].reduce((a, b) => a + b, 0);
const body = `// Every non-letter character the sample of written English actually printed, most frequent first.
// Generated by scripts/make-symbols.ts from ${PAGES.length} public Wikipedia article extracts
// (CC BY-SA 4.0; curly punctuation normalized to the key struck) — ${total.toLocaleString("en-US")} counted
// characters. Do not hand-edit: the order is a measurement. Letters are ranked by the word corpus in
// model.ts, not here; see docs/spec.md \u00A72.
export const SYMBOL_ORDER: string[] = [
${order.map((ch) => `\t"${ch === '"' ? '\\"' : ch === "\\" ? "\\\\" : ch}",`).join("\n")}
];
`;
const out = new URL("../src/lesson/symbols.ts", import.meta.url);
mkdirSync(dirname(out.pathname), { recursive: true });
writeFileSync(out, body);
console.log(`wrote ${order.length} characters, top 12: ${order.slice(0, 12).join(" ")}`);
