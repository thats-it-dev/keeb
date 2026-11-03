import { columnarKeys } from "../keyboard/columnar.ts";
import { geometry } from "../keyboard/geometry.ts";

// Corne / CRKBD (foostan), 3x6 + 3 thumb per half = 42 keys.
// Column offsets and the 1.5u inner thumb come from QMK keyboards/crkbd info.json LAYOUT_split_3x6_3;
// labels from its default keymap. The three finger rows are upper/home/lower — the number row lives on a layer.
export const CORNE = geometry({
	id: "corne",
	name: "Corne (CRKBD)",
	source: "qmk/qmk_firmware keyboards/crkbd",
	verified: true,
	rowRoles: ["upper", "home", "lower", "thumb"],
	keys: columnarKeys({
		colOffset: [30, 30, 10, 0, 10, 20],
		leftInnerX: 500,
		rightInnerX: 900,
		rows: [
			{ role: "upper", left: ["Tab", "q", "w", "e", "r", "t"], right: ["Bksp", "p", "o", "i", "u", "y"] },
			{ role: "home", left: ["Ctrl", "a", "s", "d", "f", "g"], right: ["'", ";", "l", "k", "j", "h"] },
			{ role: "lower", left: ["Shift", "z", "x", "c", "v", "b"], right: ["Esc", "/", ".", ",", "m", "n"] },
		],
		thumbs: {
			l: [
				{ col: 1, x: 4, y: 3.7, label: "LGui" },
				{ col: 2, x: 5, y: 3.7, label: "Layer" },
				{ col: 3, x: 6, y: 3.2, label: " ", h: 1.5 },
			],
			r: [
				{ col: 3, x: 8, y: 3.2, label: "Enter", h: 1.5 },
				{ col: 2, x: 9, y: 3.7, label: "Layer" },
				{ col: 1, x: 10, y: 3.7, label: "Alt" },
			],
		},
	}),
});
