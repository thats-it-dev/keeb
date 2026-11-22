import { beforeEach, describe, expect, it } from "vitest";
import { savedKeyboardVisible, setKeyboardVisible } from "../src/app/keyboard-visibility.ts";

function stubLocalStorage() {
	const map = new Map<string, string>();
	const stub: Storage = {
		getItem: (k) => (map.has(k) ? map.get(k)! : null),
		setItem: (k, v) => { map.set(k, String(v)); },
		removeItem: (k) => { map.delete(k); },
		clear: () => map.clear(),
		key: (i) => [...map.keys()][i] ?? null,
		get length() { return map.size; },
	} as Storage;
	(globalThis as any).localStorage = stub;
	return map;
}

describe("keyboard visibility store", () => {
	let map: Map<string, string>;
	beforeEach(() => { map = stubLocalStorage(); });

	it("answers true when nothing is stored", () => {
		expect(savedKeyboardVisible()).toBe(true);
	});
	it("answers true for any unrecognised stored value", () => {
		map.set("keeb:keyboardVisible", "banana");
		expect(savedKeyboardVisible()).toBe(true);
	});
	it("round-trips false and true", () => {
		setKeyboardVisible(false);
		expect(savedKeyboardVisible()).toBe(false);
		setKeyboardVisible(true);
		expect(savedKeyboardVisible()).toBe(true);
	});
});
