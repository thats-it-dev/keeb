import { GEOMETRIES, allGeometries } from "../data/geometries.ts";
import { KEYMAPS, allKeymaps } from "../data/keymaps.ts";

// Which board and which keymap, per browser. Progress itself lives in IndexedDB.
const STORE = "keeb:layout";

export type Selection = { g: string; k: string };

/**
 * The saved pair, or the shipped default. Both ids are checked against the registry rather than just read
 * back: a board the learner removed leaves a name behind in the slot, and selecting an id nothing can resolve
 * renders a page with no keys on it.
 */
export function savedSelection(): Selection {
	try {
		const v = JSON.parse(localStorage.getItem(STORE) ?? "") as { g?: string; k?: string };
		const g = v.g;
		const k = v.k;
		if (typeof g === "string" && typeof k === "string" && allGeometries().some((x) => x.id === g) && allKeymaps().some((x) => x.id === k)) {
			return { g, k };
		}
	} catch {
		/* first run or junk in the slot */
	}
	return { g: GEOMETRIES[0].id, k: KEYMAPS[0].id };
}

export function rememberSelection(sel: Selection): void {
	localStorage.setItem(STORE, JSON.stringify(sel));
}
