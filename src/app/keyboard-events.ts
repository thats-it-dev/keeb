import type { Resolved } from "../keyboard/resolve.ts";

/** Handle keyboard events for the lesson. */
export function handleKey(
	resolved: Resolved,
	settingsOpen: boolean,
	onKey: (ch: string) => void,
	e: KeyboardEvent,
): void {
	if (settingsOpen) return; // the modal owns the keyboard while it is up
	const t = e.target as HTMLElement | null;
	if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
	// Layer keys: pass through even when e.altKey is set; use browser-key map.
	// Only multi-char keys (Control, Tab, Enter) enter this path; single-char letters type normally.
	const bk = e.key.toLowerCase();
	if (e.key.length > 1 && resolved.layerKeyByBrowser.has(bk)) {
		e.preventDefault();
		onKey(resolved.layerKeyByBrowser.get(bk)!.label.toLowerCase());
		return;
	}
	// A held key is one intention, not twenty: the OS sends repeat:true keydowns at ~30/sec, and each one
	// that passed through here charged an error to the target key and turned the letter the learner has
	// not typed yet red. That reads as the line running ahead of the fingers.
	if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.key.length !== 1 && e.key !== "Enter")) return;
	e.preventDefault();
	onKey(e.key);
}
