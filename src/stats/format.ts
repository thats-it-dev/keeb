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
 * Format a non-negative integer with comma thousands separators (123456 → "123,456").
 * Locale-free: always uses a comma, never a decimal point or sign.
 */
export function formatThousands(n: number): string {
	const s = String(n);
	const start = s[0] === "-" ? 1 : 0;
	let out = s.slice(0, start);
	for (let i = start; i < s.length; i += 1) {
		if (i > start && (s.length - i) % 3 === 0) out += ",";
		out += s[i];
	}
	return out;
}
