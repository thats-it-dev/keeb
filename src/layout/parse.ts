import { U } from "../keyboard/geometry.ts";
import type { Geometry, Hand, Key, RowRole } from "../keyboard/types.ts";

// A keyboard-layout-editor JSON file (`info.json` in a ZMK/QMK config) describes one specific board:
// where every key sits, and what the vendor calls it. It carries no characters — those come from the
// keymap, which is why a board and a layout stay independent here.
//
//	{ "layouts": { "LAYOUT": { "layout": [ { "label": "L_C6R1", "row": 0, "col": 0, "x": 0, "y": 0.5 } ] } } }
export type Import = {
	geometry?: Geometry;
	problems: string[];
};

export type ImportOpts = {
	id: string;
	name: string;
	source: string;
};

// Importing the same file twice should replace the board, not add a second copy of it, so the id comes
// from the filename. Anything that is not a word character becomes a dash.
export function importId(fileName: string): string {
	const stem = baseName(fileName).replace(/\.json$/i, "").toLowerCase();
	const slug = stem.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "board";
	return `import:${slug}`;
}

// The last path segment: a re-upload from a different directory is still the same board.
function baseName(fileName: string): string {
	return fileName.slice(fileName.lastIndexOf("/") + 1);
}

// The name shown in the picker: the file's stem, since the file rarely carries one.
export function importName(fileName: string): string {
	const stem = baseName(fileName).replace(/\.json$/i, "");
	return stem ? stem.replace(/[-_]+/g, " ") : "Imported board";
}

type Raw = { label?: unknown; row?: unknown; col?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown; r?: unknown; rx?: unknown; ry?: unknown };

const ROW_ROLES: Record<number, RowRole[]> = {
	3: ["upper", "home", "lower"],
	4: ["number", "upper", "home", "lower"],
	5: ["number", "upper", "home", "lower", "thumb"],
	6: ["number", "upper", "home", "lower", "extra", "thumb"],
};

export function geometryFromLayout(json: unknown, opts: ImportOpts): Import {
	const problems: string[] = [];
	const raw = layoutArray(json, problems);
	if (!raw) return { problems };
	if (!raw.length) return { problems: [...problems, "the layout is empty"] };

	const keys: Key[] = [];
	const rows: number[] = [];
	raw.forEach((k, i) => {
		const at = num(k.x, `key ${i} (x)`, problems);
		const top = num(k.y, `key ${i} (y)`, problems);
		const row = num(k.row, `key ${i} (row)`, problems);
		const col = num(k.col, `key ${i} (col)`, problems);
		if (at === undefined || top === undefined || row === undefined || col === undefined) return;
		const label = typeof k.label === "string" ? k.label.trim() : "";
		const hand = handOfLabel(label);
		keys.push({
			id: label || `K${i}`,
			hand: hand ?? handOf(at, raw),
			row,
			col: colIndex(label, col, raw),
			x: Math.round(at * U),
			y: Math.round(top * U),
			w: Math.round((numOpt(k.w) ?? 1) * U),
			h: Math.round((numOpt(k.h) ?? 1) * U),
			rot: Math.round((numOpt(k.r) ?? 0) * 10),
			label: /^[LR]_[A-Z]?.?\d/.test(label) ? "" : label, // a vendor position name is not a legend
		});
		if (!rows.includes(row)) rows.push(row);
	});

	const rowRoles = rolesFor(rows.sort((a, b) => a - b), problems);
	// Split boards are a claim we can check: if the two halves overlap, the file was not a split.
	const split = new Set(keys.map((k) => k.hand)).size === 2;
	const geometry: Geometry = {
		id: opts.id,
		name: opts.name,
		source: opts.source,
		verified: false,
		split,
		rowRoles,
		keys: keys.sort((a, b) => a.row - b.row || a.x - b.x),
	};
	return { geometry, problems };
}

function layoutArray(json: unknown, problems: string[]): Raw[] | undefined {
	if (Array.isArray(json)) return json as Raw[];
	const layouts = (json as { layouts?: Record<string, { layout?: Raw[] }> })?.layouts;
	if (!layouts) {
		problems.push('no "layouts" object: this is not a keyboard-layout JSON file');
		return undefined;
	}
	const names = Object.keys(layouts);
	if (!names.length) {
		problems.push('"layouts" is empty');
		return undefined;
	}
	const chosen = names.includes("LAYOUT") ? "LAYOUT" : names[0];
	if (names.length > 1) problems.push(`"${chosen}" chosen; the file also offers ${names.filter((n) => n !== chosen).join(", ")}`);
	return layouts[chosen]?.layout as Raw[] | undefined;
}

function num(value: unknown, what: string, problems: string[]): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	problems.push(`${what} is not a number`);
	return undefined;
}

// Optional fields are silent when absent, but a present-but-broken one is still a mistake worth naming.
function numOpt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Without a vendor label saying which half a key is on, the widest empty vertical band is the gap
// between the halves of a split board.
function handOfLabel(label: string): Hand | undefined {
	if (label.startsWith("L_")) return "l";
	if (label.startsWith("R_")) return "r";
	return undefined;
}

function handOf(x: number, all: Raw[]): Hand {
	const xs = all.map((o) => numOpt(o.x) ?? 0).sort((a, b) => a - b);
	let gap = 0;
	let at = 0;
	for (let i = 1; i < xs.length; i += 1) {
		if (xs[i] - xs[i - 1] > gap) {
			gap = xs[i] - xs[i - 1];
			at = i;
		}
	}
	return gap > 1 && x < xs[at] ? "l" : "r";
}

// Our columns count outwards from the inner edge of each hand (col 5 = inner index key, col 0 = far
// pinky). Vendor column numbers run the other way for the alpha rows, so they are flipped; thumb keys
// are named by reach (T1 nearest the inside) and keep their own number.
function colIndex(label: string, vendorCol: number, all: Raw[]): number {
	const thumb = /^[LR]_T(\d+)/.exec(label);
	if (thumb) return Number(thumb[1]);
	const named = /^[LR]_C(\d+)/.exec(label);
	if (!named) return vendorCol;
	let max = 0;
	for (const o of all) max = Math.max(max, vendorColumn(o) ?? 0);
	return max - Number(named[1]);
}

// The number in a vendor alpha-row label: "L_C4R2" -> 4.
function vendorColumn(k: Raw): number | undefined {
	const m = /^[LR]_C(\d+)/.exec(typeof k.label === "string" ? k.label : "");
	return m ? Number(m[1]) : undefined;
}

function rolesFor(rows: number[], problems: string[]): RowRole[] {
	const dense = rows.map((r, i) => r - i);
	const shifted = dense.some((d) => d !== 0);
	const ladder = ROW_ROLES[rows.length];
	if (!ladder) {
		problems.push(`${rows.length} rows: too few to tell apart, everything is treated as a typing row`);
		return rows.map((_, i) => (i < 3 ? (["upper", "home", "lower"] as RowRole[])[i] : "extra"));
	}
	if (shifted) problems.push(`rows are numbered ${rows.join(", ")} rather than 0..${rows.length - 1}; they are read in that order`);
	return ladder;
}
