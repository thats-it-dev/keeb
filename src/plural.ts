export function plural(n: number, singular: string, plural: string): string {
	return n === 1 ? singular : plural;
}
