import { mergeAll, type StatMap } from "../stats/stats.ts";
import { emptyState as emptySyncState, type SyncState } from "../atproto/sync.ts";
import type { SessionRow } from "../atproto/records.ts";
import type { Geometry, Keymap } from "../keyboard/types.ts";

// Offline-first storage. Everything the learner does lands here immediately; atproto sync (M4)
// reads and writes the same shape, so nothing here changes when the network arrives.

const DB = "keeb";
const STATS = "stats";
const SETTINGS = "settings";
const BOARDS = "boards"; // layout files the learner imported (M3)
const MAPS = "maps"; // keymaps read out of a layout editor export (M3)
const SYNC = "sync"; // one row: which record is which, and what is waiting to be sent (M4)
const HISTORY = "history"; // session records read from the PDS, keyed by rkey, so the chart works offline (M5)
const SYNC_KEY = "state";

export type Settings = {
	geometry: string;
	keymap: string;
	// Target speed in characters per minute.
	targetCpm: number;
	// Key ids the learner has unlocked, in teaching order.
	unlocked: string[];
};

export const DEFAULT_SETTINGS: Settings = { geometry: "go60", keymap: "qwerty", targetCpm: 200, unlocked: [] };

let dbp: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
	dbp ??= new Promise((res, rej) => {
		const req = indexedDB.open(DB, 5);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STATS)) db.createObjectStore(STATS, { keyPath: "layout" });
			if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: "layout" });
			// v2: imported boards, keyed by their own id rather than by layout pair.
			if (!db.objectStoreNames.contains(BOARDS)) db.createObjectStore(BOARDS, { keyPath: "id" });
			// v3: keymaps read out of a layout editor export.
			if (!db.objectStoreNames.contains(MAPS)) db.createObjectStore(MAPS, { keyPath: "id" });
			// v4: sync bookkeeping.
			if (!db.objectStoreNames.contains(SYNC)) db.createObjectStore(SYNC, { keyPath: "key" });
			// v5: the session rows pulled from the PDS. They live on the network, but a history that is
			// blank until you are online is not a history an offline-first app can show.
			if (!db.objectStoreNames.contains(HISTORY)) db.createObjectStore(HISTORY, { keyPath: "rkey" });
		};
		req.onsuccess = () => res(req.result);
		req.onerror = () => rej(req.error);
	});
	return dbp;
}

// One record per layout (geometry + keymap), because speed on a Go60 running Colemak-DH says
// nothing about the same fingers on a Corne running QWERTY.
export function layoutKey(geometry: string, keymap: string): string {
	return `${geometry}+${keymap}`;
}

async function get<T>(store: string, key: string): Promise<T | undefined> {
	const db = await open();
	return new Promise((res, rej) => {
		const r = db.transaction(store).objectStore(store).get(key);
		r.onsuccess = () => res(r.result ? (r.result.value as T) : undefined);
		r.onerror = () => rej(r.error);
	});
}

async function put(store: string, key: string, value: unknown): Promise<void> {
	const db = await open();
	return new Promise((res, rej) => {
		const tx = db.transaction(store, "readwrite");
		tx.objectStore(store).put({ layout: key, value });
		tx.oncomplete = () => res();
		tx.onerror = () => rej(tx.error);
	});
}

export async function loadStats(key: string): Promise<StatMap> {
	return (await get<StatMap>(STATS, key)) ?? {};
}

export async function saveStats(key: string, stats: StatMap): Promise<void> {
	await put(STATS, key, stats);
}

// Used after a sync pulls someone else's numbers down.
export async function addStats(key: string, stats: StatMap): Promise<StatMap> {
	const merged = mergeAll(await loadStats(key), stats);
	await put(STATS, key, merged);
	return merged;
}

export async function loadSettings(key: string): Promise<Settings> {
	return { ...DEFAULT_SETTINGS, ...((await get<Partial<Settings>>(SETTINGS, key)) ?? {}) };
}

export async function saveSettings(key: string, s: Settings): Promise<void> {
	await put(SETTINGS, key, s);
}

export async function wipe(): Promise<void> {
	const db = await open();
	for (const store of [STATS, SETTINGS, BOARDS, MAPS, SYNC, HISTORY]) {
		await new Promise<void>((res, rej) => {
			const tx = db.transaction(store, "readwrite");
			tx.objectStore(store).clear();
			tx.oncomplete = () => res();
			tx.onerror = () => rej(tx.error);
		});
	}
}

// Imported boards survive a reload, and the picker is built from them before the first lesson starts.
export async function loadBoards(): Promise<Geometry[]> {
	const db = await open();
	return new Promise((res, rej) => {
		const r = db.transaction(BOARDS).objectStore(BOARDS).getAll();
		r.onsuccess = () => res((r.result as Geometry[]) ?? []);
		r.onerror = () => rej(r.error);
	});
}

export async function saveBoard(g: Geometry): Promise<void> {
	const db = await open();
	return new Promise((res, rej) => {
		const tx = db.transaction(BOARDS, "readwrite");
		tx.objectStore(BOARDS).put(g);
		tx.oncomplete = () => res();
		tx.onerror = () => rej(tx.error);
	});
}

export async function loadMaps(): Promise<Keymap[]> {
	const db = await open();
	return new Promise((res, rej) => {
		const r = db.transaction(MAPS).objectStore(MAPS).getAll();
		r.onsuccess = () => res((r.result as Keymap[]) ?? []);
		r.onerror = () => rej(r.error);
	});
}

export async function saveMap(k: Keymap): Promise<void> {
	const db = await open();
	return new Promise((res, rej) => {
		const tx = db.transaction(MAPS, "readwrite");
		tx.objectStore(MAPS).put(k);
		tx.oncomplete = () => res();
		tx.onerror = () => rej(tx.error);
	});
}

export async function deleteMap(id: string): Promise<void> {
	const db = await open();
	return new Promise((res, rej) => {
		const tx = db.transaction(MAPS, "readwrite");
		tx.objectStore(MAPS).delete(id);
		tx.oncomplete = () => res();
		tx.onerror = () => rej(tx.error);
	});
}

/**
 * The one row of sync bookkeeping: which record holds which layout's progress, and what still has to
 * leave the device. Losing it costs a duplicate record, never a lost session — sessions live on the PDS.
 */
/**
 * The session rows most recently seen on the PDS. `replace` writes them wholesale rather than merging:
 * the repo is the source of truth for sessions (they are created, never edited), so a row that vanished
 * there -- pruned, or deleted on another device -- has to vanish here too. Merging would resurrect it and
 * the chart would quietly keep counting a session that no longer exists.
 */
export async function saveHistory(rows: SessionRow[]): Promise<void> {
	const db = await open();
	await new Promise<void>((res, rej) => {
		const tx = db.transaction(HISTORY, "readwrite");
		const store = tx.objectStore(HISTORY);
		store.clear();
		for (const r of rows) store.put(r);
		tx.oncomplete = () => res();
		tx.onerror = () => rej(tx.error);
	});
}

export async function loadHistory(): Promise<SessionRow[]> {
	const db = await open();
	return new Promise((res, rej) => {
		const r = db.transaction(HISTORY).objectStore(HISTORY).getAll();
		r.onsuccess = () => res((r.result as SessionRow[]) ?? []);
		r.onerror = () => rej(r.error);
	});
}

export async function loadSyncState(): Promise<SyncState> {
	const db = await open();
	return new Promise((res, rej) => {
		const r = db.transaction(SYNC).objectStore(SYNC).get(SYNC_KEY);
		r.onsuccess = () => res({ ...emptySyncState(), ...((r.result as SyncState | undefined) ?? {}) });
		r.onerror = () => rej(r.error);
	});
}

export async function saveSyncState(s: SyncState): Promise<void> {
	const db = await open();
	return new Promise((res, rej) => {
		const tx = db.transaction(SYNC, "readwrite");
		tx.objectStore(SYNC).put({ key: SYNC_KEY, ...s });
		tx.oncomplete = () => res();
		tx.onerror = () => rej(tx.error);
	});
}

export async function deleteBoard(id: string): Promise<void> {
	const db = await open();
	return new Promise((res, rej) => {
		const tx = db.transaction(BOARDS, "readwrite");
		tx.objectStore(BOARDS).delete(id);
		tx.oncomplete = () => res();
		tx.onerror = () => rej(tx.error);
	});
}
