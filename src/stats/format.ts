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
