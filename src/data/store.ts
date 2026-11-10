import { mergeAll, progressGrowth, type StatMap } from "../stats/stats.ts";
import { foldDaily, type DailyRow } from "../stats/daily.ts";
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
const DAILY = "daily"; // one row per local calendar day: minutes practised on THIS device
const SYNC_KEY = "state";

export type Settings = {
	geometry: string;
	keymap: string;
	// Target speed in characters per minute.
	targetCpm: number;
	// Hand the letters out in keyboard order (cheapest row first) instead of language-frequency order.
	keyboardOrder: boolean;
	// Practise words from the corpus instead of words the letter model invents.
	realWords: boolean;
	// Minutes of practice the daily bar aims for each day. Optional and never on the wire: it is device
	// furniture like the tally it measures, and loadSettings fills the default. An old record or an old
	// row without it keeps the default rather than turning the bar off.
	dailyGoalMin?: number;
};

export const DEFAULT_SETTINGS: Settings = { geometry: "go60", keymap: "qwerty", targetCpm: 200, keyboardOrder: false, realWords: false, dailyGoalMin: 15 };

let dbp: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
	dbp ??= new Promise((res, rej) => {
		const req = indexedDB.open(DB, 6);
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
			// v6: the daily tally. Not derived from HISTORY because that store only fills from a synced repo,
			// and today's minutes have to read correctly on a device that has never been online.
			if (!db.objectStoreNames.contains(DAILY)) db.createObjectStore(DAILY, { keyPath: "day" });
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

/**
 * Fold one layout's progress record into this browser's numbers, exactly once.
 * The record on the PDS is a shared accumulator: it contains the numbers this device pushed, plus whatever
 * another device added. So the only honest question is what it has learned since we last looked at it, and
 * `progressGrowth` answers that against the copy remembered in the sync row.
 *
 * Both rows are written in one transaction. Splitting them would be the same bug in a new costume: stats
 * saved but the record not remembered means the next sync folds the same growth in again.
 */
export async function applyRemoteProgress(key: string, remote: StatMap): Promise<StatMap> {
	const db = await open();
	return new Promise((res, rej) => {
		const tx = db.transaction([STATS, SYNC], "readwrite");
		let local: StatMap | undefined;
		let state: SyncState | undefined;
		let merged: StatMap | undefined;
		tx.oncomplete = () => res(merged ?? {});
		tx.onerror = () => rej(tx.error);
		// Every request is issued from inside a request handler, so the transaction is still open when the
		// puts go in. Awaiting a promise here would let it commit out from under us.
		const both = () => {
			if (!local || !state) return;
			const seen = (state.progressSeen ?? {})[key];
			merged = mergeAll(local, progressGrowth(seen ?? {}, remote));
			tx.objectStore(STATS).put({ layout: key, value: merged });
			tx.objectStore(SYNC).put({ key: SYNC_KEY, ...state, progressSeen: { ...state.progressSeen, [key]: remote } });
		};
		const statsReq = tx.objectStore(STATS).get(key);
		statsReq.onsuccess = () => {
			local = (statsReq.result ? (statsReq.result.value as StatMap) : {}) ?? {};
			both();
		};
		const syncReq = tx.objectStore(SYNC).get(SYNC_KEY);
		syncReq.onsuccess = () => {
			state = { ...emptySyncState(), ...((syncReq.result as SyncState | undefined) ?? {}) };
			both();
		};
		statsReq.onerror = () => rej(statsReq.error);
		syncReq.onerror = () => rej(syncReq.error);
	});
}

export async function loadSettings(key: string): Promise<Settings> {
	return { ...DEFAULT_SETTINGS, ...((await get<Partial<Settings>>(SETTINGS, key)) ?? {}) };
}

export async function saveSettings(key: string, s: Settings): Promise<void> {
	await put(SETTINGS, key, s);
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

/** The whole daily tally, oldest first. The bar only reads today; the rest is fold history. */
export async function loadDaily(): Promise<DailyRow[]> {
	const db = await open();
	return new Promise((res, rej) => {
		const r = db.transaction(DAILY).objectStore(DAILY).getAll();
		r.onsuccess = () => res(((r.result as DailyRow[]) ?? []).filter((x) => x && typeof x.day === "string"));
		r.onerror = () => rej(r.error);
	});
}

/**
 * Charge `ms` to today and return the rows the screen should now read. Writing is wholesale — read,
 * fold, clear, put — because the fold prunes as it goes, and a second app-main on another tab folding
 * against a stale copy loses at most its own prune, never a day the bar shows.
 */
export async function addDaily(nowMs: number, ms: number): Promise<DailyRow[]> {
	const rows = foldDaily(await loadDaily(), nowMs, ms);
	const db = await open();
	await new Promise<void>((res, rej) => {
		const tx = db.transaction(DAILY, "readwrite");
		const store = tx.objectStore(DAILY);
		store.clear();
		for (const r of rows) store.put(r);
		tx.oncomplete = () => res();
		tx.onerror = () => rej(tx.error);
	});
	return rows;
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
