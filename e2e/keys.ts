// Turns a typed character into the Playwright key name for it. The lesson asks for whatever the
// keymap puts under a finger, including punctuation, so a plain `Key${ch}` is not enough.
export function keyName(ch: string): string {
	if (ch === " ") return "Space";
	if (/^[a-z]$/.test(ch)) return `Key${ch.toUpperCase()}`;
	if (/^[A-Z]$/.test(ch)) return `Key${ch}`;
	if (/^[0-9]$/.test(ch)) return `Digit${ch}`;
	const named: Record<string, string> = {
		"-": "Minus",
		"=": "Equal",
		"[": "BracketLeft",
		"]": "BracketRight",
		"\\": "Backslash",
		";": "Semicolon",
		"'": "Quote",
		",": "Comma",
		".": "Period",
		"/": "Slash",
		"`": "Backquote",
	};
	return named[ch] ?? ch;
}
