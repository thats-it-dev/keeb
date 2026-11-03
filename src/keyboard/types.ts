export type Hand = "l" | "r";

// What a physical row is used for. "extra" = not part of the touch-typing grid (thumb clusters, inner columns).
export type RowRole = "number" | "upper" | "home" | "lower" | "thumb" | "extra";

export type Finger = "lp" | "lr" | "lm" | "li" | "lt" | "rp" | "rr" | "rm" | "ri" | "rt";

export const FINGER_NAME: Record<Finger, string> = {
	lp: "left pinky",
	lr: "left ring",
	lm: "left middle",
	li: "left index",
	lt: "left thumb",
	rp: "right pinky",
	rr: "right ring",
	rm: "right middle",
	ri: "right index",
	rt: "right thumb",
};

// One physical key. Coordinates are in 1/100 of a key unit and rotation in 1/10 of a degree, because
// the atproto data model has no floating point type and this data has to travel as records.
export type Key = {
	id: string;
	hand: Hand;
	row: number;
	// Column counted from the outside edge of that hand: 0 = far pinky column, 5 = inner index column.
	col: number;
	x: number;
	y: number;
	w: number;
	h: number;
	rot: number;
	label: string;
};

export type Geometry = {
	id: string;
	name: string;
	source: string;
	verified: boolean;
	// True when the two halves are physically separate, so their key boxes must not overlap.
	split: boolean;
	// Physical row index -> what that row is for.
	rowRoles: RowRole[];
	keys: Key[];
};

// Six columns, index 0 = the outer (far pinky) column; "" means "use the geometry's own label".
export type KeymapRow = readonly [string, string, string, string, string, string];

export type Keymap = {
	id: string;
	name: string;
	source: string;
	rows: Partial<Record<"upper" | "home" | "lower", { l: KeymapRow; r: KeymapRow }>>;
};

export type RenderKey = Key & { char: string; finger: Finger; taught: boolean };
