import type { Geometry, Keymap, KeymapLayer, KeymapRow, LayerKey } from "../keyboard/types.ts";

// A MoErgo Layout Editor (keycap) JSON export. Unlike info.json this carries no positions: the
// "keyboard" field names a board we have to know, and "layers" is a flat array of bindings in that
// board's matrix order — per physical row, left outer to left inner, then right inner to right outer.
// So this file supplies characters, and the geometry comes from us.
export type KeycapBinding = {
	value: string;
	params?: KeycapParam[];
};

export type KeycapParam = {
	value: string;
	params?: KeycapParam[];
};

export type KeycapFile = {
	keyboard?: unknown;
	layer_names?: unknown;
	layers?: unknown;
	custom_defined_behaviors?: unknown;
};

export type KeycapImport = {
	keymap?: Keymap;
	// Which shipped board the file claims to be for, as that board's id.
	geometryId?: string;
	layerNames: string[];
	problems: string[];
};

const EMPTY: KeymapRow = ["", "", "", "", "", ""];

// ZMK keycodes that type a single character. Anything else is a shortcut, a layer key or a mouse
// click, and leaves the key showing its geometry label.
const KEYCODES: Record<string, string> = {
	A: "a", B: "b", C: "c", D: "d", E: "e", F: "f", G: "g", H: "h", I: "i", J: "j", K: "k", L: "l", M: "m",
	N: "n", O: "o", P: "p", Q: "q", R: "r", S: "s", T: "t", U: "u", V: "v", W: "w", X: "x", Y: "y", Z: "z",
	N1: "1", N2: "2", N3: "3", N4: "4", N5: "5", N6: "6", N7: "7", N8: "8", N9: "9", N0: "0",
	MINUS: "-", EQUAL: "=", LBKT: "[", RBKT: "]", BSLH: "\\", SQT: "'", SEMI: ";", COMMA: ",", DOT: ".", FSLH: "/",
	GRAVE: "`", LBRC: "{", RBRC: "}", SPACE: " ", EXCL: "!", AT: "@", HASH: "#", DLLR: "$", PRCT: "%", CARET: "^",
	AMPS: "&", ASTER: "*", LPAR: "(", RPAR: ")", UNDER: "_", PLUS: "+",
};

// Wrappers that name the key underneath: LS(MINUS) is the minus key, LC(Y) is the Y key.
const WRAPPED = /^(LS|RS|LC|RC|LG|RG|LE|LA|LT|RT)$/;

export function isKeycapFile(json: unknown): json is KeycapFile {
	const f = json as KeycapFile;
	return !!f && Array.isArray(f.layers) && f.layers.every((l) => Array.isArray(l)) && typeof f.keyboard === "string";
}

export function keymapFromKeycap(file: KeycapFile, base: Geometry, id = "keycap-import", name = "From layout file"): KeycapImport {
	const problems: string[] = [];
	const names = Array.isArray(file.layer_names) ? (file.layer_names as unknown[]).map(String) : [];
	if (typeof file.keyboard !== "string" || !file.keyboard) return { problems: [...problems, "no `keyboard` field: cannot tell which board this is"], layerNames: names };
	if (file.keyboard.trim().toLowerCase() !== base.id.toLowerCase()) {
		return { problems: [...problems, `this file is for a "${file.keyboard}", not the ${base.name} selected here`], layerNames: names };
	}
	const layer = (file.layers as unknown[])[0];
	if (!Array.isArray(layer)) return { problems: [...problems, "no layer 0 in the file"], layerNames: names };
	const bindings = layer.map((b, i) => {
		const binding = b as KeycapBinding;
		if (!binding || typeof binding.value !== "string") {
			problems.push(`layer 0 position ${i + 1} is not a binding`);
			return undefined;
		}
		return charOfBinding(binding);
	});
	if (bindings.length !== base.keys.length) {
		problems.push(`layer 0 has ${bindings.length} bindings but the ${base.name} has ${base.keys.length} keys`);
		return { problems, layerNames: names };
	}
	// Matrix order is assumed, never stated. The keys outside the typing rows are the control group:
	// if the file were ordered differently, the number row would land on the wrong keys.
	const checks = base.keys.filter((k, i) => roleOutside(k, base) && bindings[i] && single(k.label));
	const agreed = checks.filter((k) => bindings[base.keys.indexOf(k)] === k.label.toLowerCase()).length;
	if (checks.length > 4 && agreed / checks.length < 0.5) {
		problems.push(`only ${agreed} of ${checks.length} unmapped keys line up — the binding order here does not match this board`);
		return { problems, layerNames: names };
	}

	const rows: Partial<Record<"upper" | "home" | "lower", { l: string[]; r: string[] }>> = {};
	for (const [i, key] of base.keys.entries()) {
		const role = roleOfRow(base, key);
		if (role !== "upper" && role !== "home" && role !== "lower") continue;
		const bucket = (rows[role] ??= { l: [...EMPTY], r: [...EMPTY] });
		bucket[key.hand][key.col] = bindings[i] ?? "";
	}
	const done = Object.fromEntries(Object.entries(rows).map(([role, pair]) => [role, { l: tuple(pair.l), r: tuple(pair.r) }])) as Keymap["rows"];
	// Every further layer, under the index the file gave it: a characterless Fn/mouse layer drops out of
	// `layers` but never renumbers the ones above it. A short later layer refuses the whole file — a
	// half-read layer would route characters to keys the count check only ever verified on layer 0.
	const fileLayers = file.layers as unknown[];
	const layers: KeymapLayer[] = bindings.some((c) => c !== undefined) ? [{ index: 0, name: names[0] ?? "", byKeyId: byKeyIdOf(bindings, base, problems, 0) }] : [];
	for (let li = 1; li < fileLayers.length; li += 1) {
		const arr = fileLayers[li];
		if (!Array.isArray(arr)) continue;
		if (arr.length !== base.keys.length) {
			problems.push(`layer ${li} has ${arr.length} bindings but the ${base.name} has ${base.keys.length} keys`);
			return { problems, layerNames: names };
		}
		const chars = arr.map((b, i) => {
			const binding = b as KeycapBinding;
			if (!binding || typeof binding.value !== "string") {
				problems.push(`layer ${li} position ${i + 1} is not a binding`);
				return undefined;
			}
			return charOfBinding(binding);
		});
		const byKeyId = byKeyIdOf(chars, base, problems, li);
		if (Object.keys(byKeyId).length > 0) layers.push({ index: li, name: names[li] ?? "", byKeyId });
	}
	const { entries: layerKeys } = layerKeysFrom(file, base);
	return {
		keymap: {
			id,
			name,
			source: `keycap layers: ${names.join(", ") || "unnamed"}`,
			rows: done,
			...(layers.length > 1 ? { layers } : {}),
			...(layerKeys.length ? { layerKeys } : {}),
		},
		geometryId: base.id,
		layerNames: names,
		problems,
	};
}

function byKeyIdOf(chars: (string | undefined)[], base: Geometry, problems: string[], li: number): Record<string, string> {
	const byKeyId: Record<string, string> = {};
	for (const [i, key] of base.keys.entries()) {
		const c = chars[i];
		if (c === undefined) continue;
		if (byKeyId[key.id] !== undefined) problems.push(`layer ${li} types two characters on ${key.id}`);
		byKeyId[key.id] = c;
	}
	return byKeyId;
}

/** The keys that activate layers, in order of first appearance. A layer-tap or momentary binding is a
 *  layer key wherever it lives; a Custom name counts only when `custom_defined_behaviors` declares it a
 *  hold-tap whose hold side is `&mo` — the home-row mods (`bindings = <&kp>, <&kp>`) type a key and must
 *  not be mistaken for one. */
export function layerKeysFrom(file: KeycapFile, base: Geometry): { entries: LayerKey[]; problems: string[] } {
	const entries: LayerKey[] = [];
	const problems: string[] = [];
	const holdTaps = holdTapBehaviorNames(file);
	const seen = new Set<string>();
	const fileLayers = Array.isArray(file.layers) ? (file.layers as unknown[]) : [];
	for (const [li, arr] of fileLayers.entries()) {
		if (!Array.isArray(arr)) continue;
		for (const [i, b] of (arr as KeycapBinding[]).entries()) {
			const tokens = bindingTokens(b);
			if (!tokens) continue;
			const head = (tokens[0] ?? "").replace(/^&/, "").toLowerCase();
			const layer = Number(tokens[1]);
			if (!Number.isInteger(layer) || layer < 0 || layer >= Math.max(fileLayers.length, (file.layer_names as unknown[] | undefined)?.length ?? 0)) continue;
			let activation: LayerKey["activation"] | undefined;
			if (head === "lt") activation = "hold-tap";
			else if (head === "mo") activation = "momentary";
			else if (head === "df") activation = "toggle";
			else if (holdTaps.has(head)) activation = "hold-tap";
			if (!activation) continue;
			const keyId = base.keys[i]?.id;
			if (!keyId) {
				problems.push(`layer ${li} position ${i + 1} names a key this board does not have`);
				continue;
			}
			const at = `${layer}|${keyId}`;
			if (seen.has(at)) continue;
			seen.add(at);
			entries.push({ layer, keyId, activation });
		}
	}
	return { entries, problems };
}

// "&mo" with params, or a Custom string: either form is a behaviour name followed by its cells.
function bindingTokens(b: KeycapBinding | undefined): string[] | undefined {
	if (!b || typeof b.value !== "string") return undefined;
	if (b.value === "Custom") {
		const raw = b.params?.[0]?.value;
		return typeof raw === "string" ? raw.trim().split(/\s+/) : undefined;
	}
	if (!b.value.startsWith("&")) return undefined;
	return [b.value, ...(b.params ?? []).map((p) => p.value)];
}

function holdTapBehaviorNames(file: KeycapFile): Set<string> {
	const src = typeof file.custom_defined_behaviors === "string" ? file.custom_defined_behaviors : "";
	const names = new Set<string>();
	for (const m of src.matchAll(/([\w-]+)(?:\s*:\s*[\w-]+)?\s*\{[^{}]*compatible\s*=\s*"zmk,behavior-hold-tap"[^{}]*bindings\s*=\s*<&mo>\s*,\s*<&kp>/g)) {
		names.add(m[1]);
	}
	return names;
}

// Working arrays are mutable; the published row type is a fixed 6-tuple.
function tuple(row: string[]): KeymapRow {
	return [row[0] ?? "", row[1] ?? "", row[2] ?? "", row[3] ?? "", row[4] ?? "", row[5] ?? ""];
}

/** The character a binding types, if it types one. */
export function charOfBinding(b: KeycapBinding): string | undefined {
	// Behaviour names arrive both as "&kp" and as a bare "Custom", so compare without the "&" and
	// without case.
	const head = (b.value.startsWith("&") ? b.value.slice(1) : b.value).toLowerCase();
	if (head === "kp") return charOfParam(b.params?.[0]);
	if (head === "mt" || head === "lt" || head === "hk") return charOfParam(b.params?.at(-1)); // hold something, tap a key
	if (head === "custom" || head === "macro") return charOfCustom(b.params?.[0]?.value);
	return undefined; // &trans, &none, &mo, &magic, &bt, &mkp, a board behaviour
}

function charOfParam(p: KeycapParam | undefined): string | undefined {
	if (!p) return undefined;
	const inner = p.params?.[0];
	if (inner && WRAPPED.test(p.value)) return charOfParam(inner); // LS(MINUS) is the minus key
	return KEYCODES[p.value.toUpperCase()];
}

// A Custom binding holds raw devicetree text: "&lt 1 LC(UP)" or "&kp LG(LS(N5))".
function charOfCustom(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const tokens = raw.trim().split(/\s+/);
	const head = (tokens.shift() ?? "").replace(/^&/, "").toLowerCase();
	if (head === "kp") return unwrapKeycode(tokens.join(" "));
	if (head === "hml" || head === "hmr" || head === "lt") return unwrapKeycode(tokens.at(-1) ?? ""); // hold something, tap a key
	return undefined;
}

// The key-underneath doctrine, on text: peel the innermost modifier call until a keycode is bare.
function unwrapKeycode(text: string): string | undefined {
	let t = text.trim();
	for (let depth = 0; depth < 5; depth += 1) {
		if (/^\w+$/.test(t)) return KEYCODES[t.toUpperCase()];
		const groups = [...t.matchAll(/\(([^()]*)\)/g)]; // the innermost calls are the ones with no nested parens
		const inner = groups.at(-1)?.[1];
		if (inner === undefined) return undefined;
		t = (inner.split(/[, ]/).pop() ?? "").trim();
	}
	return undefined;
}

function roleOfRow(g: Geometry, k: { row: number }): "upper" | "home" | "lower" | "number" | "extra" | "thumb" {
	return (g.rowRoles[k.row] ?? "extra") as "upper" | "home" | "lower" | "number" | "extra" | "thumb";
}

function roleOutside(k: { row: number; col: number }, g: Geometry): boolean {
	const role = roleOfRow(g, k);
	return role === "number" || (["upper", "home", "lower"].includes(role) && k.col === 0);
}

function single(text: string): boolean {
	return [...text].length === 1;
}
