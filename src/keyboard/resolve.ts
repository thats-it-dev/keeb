import { bounds, fingerOf, geometryProblems, roleOf } from "../keyboard/geometry.ts";
import type { Geometry, Key, Keymap, LayerKey, RenderKey } from "../keyboard/types.ts";

export type Resolved = {
	geometry: Geometry;
	keys: RenderKey[];
	byId: Map<string, RenderKey>;
	// Lowercased typed character -> key id. Only single-character labels are indexable.
	byChar: Map<string, string>;
	// Key id for Enter, so the board lights it when the learner advances.
	enterKey: string | undefined;
	viewBox: { x: number; y: number; width: number; height: number };
	problems: string[];
	// Layer data from the keymap, if present.
	layers?: string[][];
	layerNames?: string[];
	layerKeys?: LayerKey[];
	// Keymap-sent character (lowercased) -> layer key info for layer-switch keys.
	layerKeyByPhysical: Map<string, LayerKey & { label: string; char: string }>;
	// Browser key name (lowercased, e.g. "control") -> layer key info.
	layerKeyByBrowser: Map<string, LayerKey & { label: string; char: string }>;
};

const ALPHA = ["upper", "home", "lower"] as const;

// A key the keymap claims: one of the three touch-typing rows, and not the outer column.
export function isTaught(g: Geometry, k: Key): boolean {
	const role = roleOf(g, k.row);
	return ALPHA.includes(role as (typeof ALPHA)[number]) && k.col >= 1;
}

export function charFor(g: Geometry, kmap: Keymap, k: Key): string {
	// A shared layout names this exact key, so its character wins outright. The row grid is the shape that
	// shipped before records existed and stays the fallback for the built-in boards.
	const named = kmap.byKey?.[k.id];
	if (named) return named;
	if (!isTaught(g, k)) return k.label;
	const role = roleOf(g, k.row) as "upper" | "home" | "lower";
	return kmap.rows[role]?.[k.hand][k.col] || k.label;
}

export function resolve(g: Geometry, kmap: Keymap): Resolved {
	const keys: RenderKey[] = [];
	const byId = new Map<string, RenderKey>();
	const byChar = new Map<string, string>();
	const problems = [...geometryProblems(g)];
	for (const k of g.keys) {
		const char = charFor(g, kmap, k);
		const rk: RenderKey = { ...k, char, finger: fingerOf(g, k), taught: false };
		keys.push(rk);
		byId.set(k.id, rk);
		// Untaught keys first: the keymap is allowed to overwrite these next.
		if ([...char].length === 1 && !isTaught(g, k)) byChar.set(char.toLowerCase(), k.id);
	}
	for (const k of keys) {
		if (!isTaught(g, k) || [...k.char].length !== 1) continue;
		k.taught = true;
		const c = k.char.toLowerCase();
		const other = byId.get(byChar.get(c) ?? "");
		if (other && isTaught(g, other)) problems.push(`"${c}" is on two keys (${other.id} and ${k.id})`);
		byChar.set(c, k.id);
	}
	const { width, height } = bounds(keys);
	const enterKey = keys.find((k) => k.label === "Enter" || k.char === "Enter")?.id;

	// Layer data from the keymap.
	const layers = kmap.layers;
	const layerNames = kmap.layerNames;
	const layerKeys = kmap.layerKeys;

	// Build layerKeyByPhysical: physical label (geometry key.label lowercased) → layer key info.
	// Includes &trans (toLayer:0) keys so the engine can route them back to base layer.
	const layerKeyByPhysical = new Map<string, LayerKey & { label: string; char: string }>();
	// Browser key name (lowercased, e.g. "control") → layer key info for layer-switch keys.
	// This lets #onKey match e.key without hardcoding browser→label translations.
	const layerKeyByBrowser = new Map<string, LayerKey & { label: string; char: string }>();
	if (layerKeys) {
		for (const lk of layerKeys) {
			const rk = byId.get(lk.keyId);
			if (!rk) continue;
			// The engine-side map is keyed by the character the keymap says the key sends (label fallback),
			// so a remapped board routes its layer keys by what the key actually sends, not the printed label.
			const sent = rk.char.toLowerCase();
			const entry = { ...lk, label: rk.label, char: rk.char };
			// The first entry wins: a base-layer switch (e.g. &lt 1 on the space bar) takes
			// priority over a &trans fallback on the same physical key in a higher layer.
			if (!layerKeyByPhysical.has(sent)) {
						layerKeyByPhysical.set(sent, entry);
			}
			const browserKey = labelToBrowserKey(rk.label);
			if (!layerKeyByBrowser.has(browserKey)) {
						layerKeyByBrowser.set(browserKey, entry);
			}
		}
	}

	return { geometry: g, keys, byId, byChar, enterKey, viewBox: { x: -20, y: -20, width: width + 40, height: height + 40 }, problems, layers, layerNames, layerKeys, layerKeyByPhysical, layerKeyByBrowser };
}

// Map a geometry key label (lowercased) to the browser's e.key value for layer-switch keys.
// Handles common aliases like "lctrl" → "control", "gui" → "meta", etc.
export function labelToBrowserKey(label: string): string {
	const lower = label.toLowerCase();
	// Modifier keys with common aliases
	if (lower === "ctrl" || lower === "lctrl" || lower === "rctrl" || lower === "leftctrl" || lower === "rightctrl") return "control";
	if (lower === "shift" || lower === "lshift" || lower === "rshift" || lower === "leftshift" || lower === "rightshift") return "shift";
	if (lower === "alt" || lower === "lalt" || lower === "ralt" || lower === "leftalt" || lower === "rightalt") return "alt";
	if (lower === "gui" || lower === "meta" || lower === "super" || lower === "cmd" || lower === "lgui" || lower === "rgui") return "meta";
	// Enter/Return: browser sends "Enter"
	if (lower === "enter" || lower === "return") return "enter";
	// Space, tab, and other single-character or short keys
	if (lower === " " || lower === "space" || lower === "␣") return " ";
	if (lower === "tab") return "tab";
	if (lower === "backspace") return "backspace";
	if (lower === "delete" || lower === "del") return "delete";
	if (lower === "escape" || lower === "esc") return "escape";
	// A letter or letter-prefixed label (e.g. "fn", "nav", "sym"): the browser reports the first character.
	if (lower.length && /[a-z]/.test(lower[0])) return lower[0];
	return lower;
}

export function keyLabel(k: { id: string; char: string }): string {
	if (k.char === " ") return "space";
	return k.char.trim() === "" ? k.id : k.char;
}
