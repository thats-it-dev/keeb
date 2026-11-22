// The keyboard board shows or hides on one click; the choice is remembered on this device only,
// exactly like the daily-goal minutes (never per-layout, never on the wire).
const STORE = "keeb:keyboardVisible";

export function savedKeyboardVisible(): boolean {
	const raw = localStorage.getItem(STORE);
	if (raw === null) return true;
	return raw !== "false"; // any other value answers with the shipped default, never a crash
}

export function setKeyboardVisible(visible: boolean): void {
	localStorage.setItem(STORE, String(visible));
}
