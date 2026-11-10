import { GEOMETRIES, allGeometries, forgetGeometry, geometryById, registerGeometry } from "../data/geometries.ts";
import { KEYMAPS, allKeymaps, forgetKeymap, registerKeymap } from "../data/keymaps.ts";
import { deleteBoard, deleteMap, loadBoards, loadMaps, saveBoard, saveMap } from "../data/store.ts";
import { boardFromLayout, type SharedLayout } from "../atproto/records.ts";
import type { SharedLayoutRow } from "../atproto/sync.ts";
import { geometryFromLayout, importId, importName } from "../layout/parse.ts";
import { isKeycapFile, keymapFromKeycap, type KeycapFile } from "../layout/keycap.ts";
import type { Geometry, Keymap } from "../keyboard/types.ts";

/** The layouts this browser holds beyond the shipped ones: imported boards and shared boards and keymaps. */
export type Layouts = { boards: Geometry[]; maps: Keymap[] };

/** What changed in the lists, and which layout the page should now show. */
export type LayoutChange = Partial<Layouts> & { geometryId?: string; keymapId?: string; problems?: string[] };

/** Imported boards survive a reload, and the picker is built from them before the first lesson starts. */
export async function loadLayouts(): Promise<Layouts> {
	const [boards, maps] = await Promise.all([loadBoards(), loadMaps()]);
	for (const b of boards) registerGeometry(b);
	for (const m of maps) registerKeymap(m);
	return { boards, maps };
}

/** Register, store, and select one layout read from a file. Two shapes arrive here: a
 * keyboard-layout-editor info.json, which describes a board's positions, and a MoErgo Layout Editor
 * export, which names a board and gives the characters. The same control takes either.
 */
export async function importLayout(text: string, fileName: string, layouts: Layouts, currentGeometryId: string): Promise<LayoutChange> {
	const id = importId(fileName);
	try {
		const json: unknown = JSON.parse(text);
		if (isKeycapFile(json)) return await importKeycap(json, fileName, id, layouts, currentGeometryId);
		const { geometry, problems } = geometryFromLayout(json, { id, name: importName(fileName), source: fileName });
		// Re-importing the same file replaces the earlier copy rather than piling up near-duplicates.
		if (!geometry) return { problems };
		forgetGeometry(id);
		registerGeometry(geometry);
		await saveBoard(geometry);
		return { problems, boards: [...layouts.boards.filter((b) => b.id !== id), geometry], geometryId: id };
	} catch (err) {
		return { problems: [`${fileName}: ${(err as Error).message}`] };
	}
}

// A layout editor export carries characters, not positions: the board it names has to be one we know.
// When it names something we don't have, it is checked against the board already on screen, and the
// resulting problem says so in terms of both.
async function importKeycap(file: KeycapFile, fileName: string, id: string, layouts: Layouts, currentGeometryId: string): Promise<LayoutChange> {
	const named = String(file.keyboard ?? "").toLowerCase();
	const base = allGeometries().find((g) => g.id === named) ?? geometryById(currentGeometryId);
	const { keymap, problems } = keymapFromKeycap(file, base, id, importName(fileName));
	if (!keymap) return { problems };
	forgetKeymap(id);
	registerKeymap(keymap);
	await saveMap(keymap);
	return { problems, maps: [...layouts.maps.filter((m) => m.id !== id), keymap], keymapId: id };
}

/** The board or keymap a shared record brought with it: register and store it, if we don't already have it. */
export async function adoptShared(row: SharedLayoutRow, layouts: Layouts): Promise<Layouts> {
	const { geometry, keymap } = boardFromLayout(row.rkey, row.layout);
	const next: Layouts = { boards: [...layouts.boards], maps: [...layouts.maps] };
	if (!allGeometries().some((x) => x.id === geometry.id)) {
		registerGeometry(geometry);
		await saveBoard(geometry);
		next.boards.push(geometry);
	}
	if (!allKeymaps().some((x) => x.id === keymap.id)) {
		registerKeymap(keymap);
		await saveMap(keymap);
		next.maps.push(keymap);
	}
	return next;
}

/** The layout on screen as the record the account will hold: positions plus the characters it resolved. */
export function sharedLayout(g: Geometry, keys: { id: string; char: string }[]): SharedLayout {
	const byKey: Record<string, string> = {};
	for (const key of keys) byKey[key.id] = key.char;
	return { name: g.name, source: g.source, geometry: { split: g.split, rowRoles: g.rowRoles, keys: g.keys }, byKey };
}

export async function removeBoard(id: string, layouts: Layouts, currentGeometryId: string): Promise<{ boards: Geometry[]; geometryId: string }> {
	forgetGeometry(id);
	await deleteBoard(id);
	return {
		boards: layouts.boards.filter((b) => b.id !== id),
		geometryId: currentGeometryId === id ? GEOMETRIES[0].id : currentGeometryId,
	};
}

export async function removeMap(id: string, layouts: Layouts, currentKeymapId: string): Promise<{ maps: Keymap[]; keymapId: string }> {
	forgetKeymap(id);
	await deleteMap(id);
	return {
		maps: layouts.maps.filter((m) => m.id !== id),
		keymapId: currentKeymapId === id ? KEYMAPS[0].id : currentKeymapId,
	};
}
