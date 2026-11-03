import { writeFileSync } from "node:fs";

// The pasted file, stripped of personal metadata (uuid, creator, date) but structurally identical:
// 60 bindings per layer in matrix order, four layers, nested LS()/LC() wrappers, a Custom string,
// macros by name, and mouse/none/trans entries that type nothing.
const letters = "abcdefghijklmnopqrstuvwxyz";

const kp = (v: string) => ({ value: "&kp", params: [{ value: v }] });
const shifted = (v: string) => ({ value: "&kp", params: [{ value: "LS", params: [{ value: v }] }] });
const chord = (v: string) => ({ value: "&kp", params: [{ value: "LC", params: [{ value: v }] }] });

// Row order in a keycap export is the board's matrix order: per physical row, left outer to left
// inner, then right inner to right outer. Six rows of twelve, then six inner and six thumb keys.
const row1 = ["&mt ESC GRAVE", "N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N0", "S(MINUS)"].map((t) =>
	t.startsWith("&mt") ? { value: "&mt", params: [{ value: "ESC" }, { value: "GRAVE" }] } : t.startsWith("S(") ? shifted(t.slice(2, -1)) : kp(t),
);
const row2 = ["TAB", "B", "L", "D", "C", "V", "J", "F", "O", "U", "COMMA", "BSPC"].map(kp);
const row3 = ["LCTRL", "N", "R", "T", "S", "G", "Y", "H", "A", "E", "I", "RET"].map(kp);
const row4 = ["MAGIC", "X", "Q", "M", "W", "Z", "K", "P", "SQT", "SEMI", "DOT", "S(EQUAL)"].map((t) =>
	t === "MAGIC" ? { value: "&magic" } : t.startsWith("S(") ? shifted(t.slice(2, -1)) : kp(t),
);
const row5 = ["GRAVE", "S(LBKT)", "WSL", "WSR", "S(RBKT)", "FSLH"].map((t) =>
	t === "WSL" ? { value: "&workspace_left" } : t === "WSR" ? { value: "&workspace_right" } : t.startsWith("S(") ? shifted(t.slice(2, -1)) : kp(t),
);
const row6 = ["LALT", "LGUI", "SPACE", "RGUI", "RSHFT", "CUSTOM"].map((t) =>
	t === "CUSTOM" ? { value: "Custom", params: [{ value: "&lt 1 LC(UP)" }] } : kp(t),
);

const main = [...row1, ...row2, ...row3, ...row4, ...row5, ...row6];
const trans = { value: "&trans" };
const symbol = [...main.map((b, i) => (i < 12 ? shifted(i % 2 ? `N${(i % 10) | 0}` : "MINUS") : b === trans ? b : trans))].slice(0, 60);
const mouse = Array.from({ length: 60 }, (_, i) => (i === 57 ? { value: "&mkp", params: [{ value: "LCLK" }] } : { value: "&none" }));
const magic = [...Array.from({ length: 60 }, (_, i) => (i < 12 ? chord(letters[i % 26].toUpperCase()) : trans))];

writeFileSync(
	"test/fixtures/go60-keycap.json",
	JSON.stringify(
		{
			version: 1,
			keyboard: "go60",
			firmware_api_version: "1",
			locale: "en-US",
			title: "Main-Go60",
			notes: "fixture derived from a MoErgo Layout Editor export",
			tags: ["gallium"],
			layer_names: ["Main", "SymNav", "mouse", "Magic"],
			layers: [main, symbol, mouse, magic],
			macros: [{ name: "&workspace_left", description: "", bindings: [kp("RCTRL"), kp("LEFT")], params: [] }],
			combos: [],
			holdTaps: [],
		},
		null,
		2,
	) + "\n",
);
console.log("bindings per layer:", [main, symbol, mouse, magic].map((l) => l.length).join(", "));
