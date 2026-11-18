import { routeLayer } from "./stats.ts";

/** What a stat id means to a human: "T" on the base layer, "1 · NavNum" on a layer, the raw id when the
 *  caller's layout knows nothing about it. The two lookups arrive as functions so this stays honest when
 *  the row comes from an OLD session whose keymap is gone from this browser. */
export function describeRoute(statId: string, charOf: (s: string) => string, layerName: (l: number) => string): string {
	const c = charOf(statId);
	if (c === statId) return statId;
	const label = c === " " ? "space" : c.toUpperCase();
	const layer = routeLayer(statId);
	if (layer === 0) return label;
	const name = layerName(layer);
	return `${label} · ${name === "" ? `layer ${layer}` : name}`;
}

/** Format total practised minutes as a human-readable string. */
export function formatPractised(minutes: number): string {
	if (minutes < 60) {
		return `${minutes} min`;
	}
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (m === 0) {
		return `${h} h`;
	}
	return `${h} h ${m} min`;
}

/**
 * Format an integer with comma thousands separators (123456 → "123,456").
 * Locale-free: always uses a comma, never a decimal point.
 * Fractions are rounded to the nearest integer first.
 */
export function formatThousands(n: number): string {
	const s = String(Math.round(n));
	const start = s[0] === "-" ? 1 : 0;
	let out = s.slice(0, start);
	for (let i = start; i < s.length; i += 1) {
		if (i > start && (s.length - i) % 3 === 0) out += ",";
		out += s[i];
	}
	return out;
}
