import type { Keymap } from "../keyboard/types.ts";

// Position-based keymaps: index 0 of each row is the outer (far pinky) column and is left "" so the
// geometry's own label shows. Arrays run outer -> inner on the left hand and outer -> inner on the
// right, which is why the right-hand rows read backwards compared with a staggered diagram.
//
// Sources, checked 2026-11-03: QWERTY is the de-facto US arrangement; Colemak-DH from
// colemakmods.github.io/mod-dh (the layout itself is public domain); Workman from the xkb file in
// github/workman-layout/Workman; Dvorak from en.wikipedia.org/wiki/Dvorak_keyboard_layout; Norman
// from normanlayout.info/learn.html.

export const KEYMAPS: Keymap[] = [
	{
		id: "qwerty",
		name: "QWERTY",
		source: "de facto",
		rows: {
			upper: { l: ["", "q", "w", "e", "r", "t"], r: ["", "p", "o", "i", "u", "y"] },
			home: { l: ["", "a", "s", "d", "f", "g"], r: ["", ";", "l", "k", "j", "h"] },
			lower: { l: ["", "z", "x", "c", "v", "b"], r: ["", "/", ".", ",", "m", "n"] },
		},
	},
	{
		id: "colemak-dh",
		name: "Colemak-DH",
		source: "colemakmods.github.io/mod-dh (public domain)",
		rows: {
			upper: { l: ["", "q", "w", "f", "p", "b"], r: ["", ";", "y", "u", "l", "j"] },
			home: { l: ["", "a", "r", "s", "t", "g"], r: ["", "o", "i", "e", "n", "m"] },
			lower: { l: ["", "z", "x", "c", "v", "d"], r: ["", "/", ".", ",", "k", "h"] },
		},
	},
	{
		id: "workman",
		name: "Workman",
		source: "workmanlayout.org",
		rows: {
			upper: { l: ["", "q", "d", "r", "w", "b"], r: ["", ";", "p", "u", "f", "j"] },
			home: { l: ["", "a", "s", "h", "t", "g"], r: ["", "o", "i", "e", "n", "y"] },
			lower: { l: ["", "z", "x", "m", "c", "v"], r: ["", "/", ",", ".", "l", "k"] },
		},
	},
	{
		id: "dvorak",
		name: "Dvorak",
		source: "en.wikipedia.org/wiki/Dvorak_keyboard_layout",
		rows: {
			upper: { l: ["", "'", ",", ".", "p", "y"], r: ["", "l", "r", "c", "g", "f"] },
			home: { l: ["", "a", "o", "e", "u", "i"], r: ["", "s", "n", "t", "h", "d"] },
			lower: { l: ["", ";", "q", "j", "k", "x"], r: ["", "z", "v", "w", "m", "b"] },
		},
	},
	{
		id: "norman",
		name: "Norman",
		source: "normanlayout.info",
		rows: {
			upper: { l: ["", "q", "w", "d", "f", "k"], r: ["", ";", "l", "r", "u", "j"] },
			home: { l: ["", "a", "s", "e", "t", "g"], r: ["", "h", "o", "i", "n", "y"] },
			lower: { l: ["", "z", "x", "c", "v", "b"], r: ["", "/", ".", ",", "m", "p"] },
		},
	},
];

export function keymapById(id: string): Keymap {
	return KEYMAPS.find((k) => k.id === id) ?? KEYMAPS[0];
}
