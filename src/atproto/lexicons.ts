// The lexicons for app.thatsit.typing.*, as data rather than JSON files: the browser client needs them
// to describe what it writes, and M5 publishes the same objects to the network.
//
// Two rules run through all of it. Every number is an integer, because the atproto data model has no
// float: positions are 1/100 of a key unit, rotations 1/10 of a degree, and a key's mean time-to-type is
// milliseconds x 16. And no keystroke is ever a record — the smallest thing stored is one session.

const NS = "app.thatsit.typing";

export const SETTINGS = `${NS}.settings`;
export const PROGRESS = `${NS}.progress`;
export const SESSION = `${NS}.session`;
export const LAYOUT = `${NS}.layout`;

/** What a PDS must be asked to accept before it will store any of this. */
export const SCOPES = `atproto offline_access repo:${SETTINGS} repo:${PROGRESS} repo:${SESSION} repo:${LAYOUT}`;

const integer = { type: "integer" } as const;
const string = { type: "string", maxGraphemes: 100 } as const;

// One physical key. `keyId` is stable per geometry, so stats and character maps can point at it. It is
// not called `id`: goat flags that as a reserved word across language code generators, and a published
// field name can never be changed, so the cheaper rename happens now.
const key = {
	type: "object",
	required: ["keyId", "hand", "row", "col", "x", "y", "w", "h", "rot"],
	properties: {
		keyId: string,
		hand: { type: "string", knownValues: ["l", "r"] },
		row: integer,
		// Counted from the outside edge of that hand, so a columnar board stores no mirror maths.
		col: integer,
		x: integer,
		y: integer,
		w: integer,
		h: integer,
		rot: integer,
		label: { type: "string", maxGraphemes: 20 },
	},
};

const char = {
	type: "object",
	required: ["keyId", "char"],
	properties: { keyId: string, char: { type: "string", maxGraphemes: 4 } },
};

// The fixed-point form of KeyStat. Weighting the mean by `samples` is what lets two devices merge
// without a coordinator, so all three fields travel together. `bestMs16` is the exception: it is a `min`,
// not a sum, and it is optional because every record written before it existed has no memory of its own
// past — `statsFrom` falls back to the current mean there.
const keyStat = {
	type: "object",
	required: ["keyId", "ttMs16", "samples", "errors"],
	properties: { keyId: string, ttMs16: integer, bestMs16: integer, samples: integer, errors: integer },
};

export const defs = {
	lexicon: 1,
	id: `${NS}.defs`,
	defs: {
		keyGeometry: {
			type: "object",
			required: ["keys"],
			properties: {
				split: { type: "boolean" },
				// Physical row -> what that row is for. It travels because a receiving device cannot infer it:
				// without it there is no way to tell the home row from the number row on a board it has never
				// seen, and the lesson engine, fingering and taught-key logic all key off it.
				rowRoles: { type: "array", items: { type: "string", knownValues: ["number", "upper", "home", "lower", "thumb", "extra"] }, maxLength: 32 },
				keys: { type: "array", items: { type: "ref", ref: "#key" }, maxLength: 200 },
			},
		},
		key,
		charMap: {
			type: "object",
			required: ["chars"],
			properties: { chars: { type: "array", items: { type: "ref", ref: "#char" }, maxLength: 200 } },
		},
		char,
		keyStats: {
			type: "array",
			items: { type: "ref", ref: "#keyStat" },
			maxLength: 200,
		},
		keyStat,
	},
};

export const settings = {
	lexicon: 1,
	id: SETTINGS,
	defs: {
		main: {
			description: "Which board and keymap this learner is practising, and how fast they want to be. One record per account.",
			type: "record",
			key: "literal:self",
			record: {
				type: "object",
				required: ["geometry", "keymap", "targetCpm", "updatedAt"],
				properties: {
					geometry: string,
					keymap: string,
					targetCpm: integer,
					// Seconds since the epoch as an integer; the lexicon has no datetime requirement here
					// because a device that has never seen a network still has to be able to write it.
					updatedAt: integer,
					// The two curriculum switches. They are preferences, so they travel; which letters are open is
					// a verdict about the learner's numbers, so it is derived from the stats on every line instead.
					keyboardOrder: { type: "boolean" },
					realWords: { type: "boolean" },
				},
			},
		},
	},
};

export const progress = {
	lexicon: 1,
	id: PROGRESS,
	defs: {
		main: {
			description: "Per-key practice totals for one board+keymap pair. Additive: two devices merge by summing samples.",
			type: "record",
			key: "tid",
			record: {
				type: "object",
				required: ["layout", "stats", "updatedAt"],
				properties: {
					// "geometry+keymap": the same key the local store uses, so a record maps onto one
					// IndexedDB entry and back without a lookup table.
					layout: string,
					stats: { type: "ref", ref: `${NS}.defs#keyStats` },
					updatedAt: integer,
				},
			},
		},
	},
};

export const session = {
	lexicon: 1,
	id: SESSION,
	defs: {
		main: {
			description: "One practice session: the span between two silences. Keystrokes are never stored individually.",
			type: "record",
			key: "tid",
			record: {
				type: "object",
				required: ["layout", "chars", "errors", "ms", "stats"],
				properties: {
					layout: string,
					chars: integer,
					errors: integer,
					ms: integer,
					// Per-key means for this session alone, which is what a later lesson would be built from.
					stats: { type: "ref", ref: `${NS}.defs#keyStats` },
				},
			},
		},
	},
};

export const layout = {
	lexicon: 1,
	id: LAYOUT,
	defs: {
		main: {
			description: "A shareable layout: where the keys are, and what characters they produce.",
			type: "record",
			key: "tid",
			record: {
				type: "object",
				required: ["name", "geometry", "charMap"],
				properties: {
					name: string,
					geometry: { type: "ref", ref: `${NS}.defs#keyGeometry` },
					charMap: { type: "ref", ref: `${NS}.defs#charMap` },
					source: { type: "string", maxGraphemes: 300 },
				},
			},
		},
	},
};

export const LEXICONS = [defs, settings, progress, session, layout];
