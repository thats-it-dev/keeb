import { columnarKeys } from "../keyboard/columnar.ts";
import { geometry } from "../keyboard/geometry.ts";

// Lily58 (Kitsune/keebio), 4x6 + 5 thumb per half = 58 keys.
// Column stagger is inherited from the corne family; the 5-key thumb arc is our own approximation of
// the stock plate, so treat the cluster positions as unverified until someone measures it.
export const LILY58 = geometry({
	id: "lily58",
	name: "Lily58",
	source: "derived: crkbd column geometry + Lily58 4x6/5-thumb topology",
	verified: false,
	rowRoles: ["number", "upper", "home", "lower", "thumb"],
	keys: columnarKeys({
		colOffset: [50, 30, 10, 0, 10, 30],
		leftInnerX: 500,
		rightInnerX: 900,
		rows: [
			{ role: "number", left: ["`", "1", "2", "3", "4", "5"], right: ["-", "0", "9", "8", "7", "6"] },
			{ role: "upper", left: ["Tab", "q", "w", "e", "r", "t"], right: ["Bksp", "p", "o", "i", "u", "y"] },
			{ role: "home", left: ["Ctrl", "a", "s", "d", "f", "g"], right: ["'", ";", "l", "k", "j", "h"] },
			{ role: "lower", left: ["Shift", "z", "x", "c", "v", "b"], right: ["Esc", "/", ".", ",", "m", "n"] },
		],
		thumbs: {
			l: [
				{ col: 1, x: 3.5, y: 3.7, label: "LGui" },
				{ col: 2, x: 4.5, y: 3.7, label: "Layer" },
				{ col: 3, x: 5.5, y: 3.2, label: " ", h: 1.4 },
				{ col: 4, x: 6, y: 4.5, rot: 25, label: "Alt" },
				{ col: 5, x: 6.3, y: 5.3, rot: 40, label: "Tab" },
			],
			r: [
				{ col: 1, x: 9.5, y: 3.7, label: "Bksp" },
				{ col: 2, x: 8.5, y: 3.7, label: "Layer" },
				{ col: 3, x: 8, y: 3.2, label: "Enter", h: 1.4 },
				{ col: 4, x: 7.9, y: 4.5, rot: 25, label: "Alt" },
				{ col: 5, x: 7.6, y: 5.3, rot: 40, label: "Up" },
			],
		},
	}),
});
