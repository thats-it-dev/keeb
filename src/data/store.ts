import { mergeAll, type StatMap } from "../stats/stats.ts";
import type { Geometry } from "../keyboard/types.ts";

// Offline-first storage. Everything the learner does lands here immediately; atproto sync (M4)
// reads and writes the same shape, so nothing here changes when the network arrives.

const DB = "touchtype";
const STATS = "stats";
const SETTINGS = "settings";
const BOARDS = "boards"; // layout files the learner imported (M3)

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
		const req = indexedDB.open(DB, 2);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(STATS, { keyPath: "layout" });
			req.result.createObjectStore(SETTINGS, { keyPath: "layout" });
			// v2: imported boards, keyed by their own id rather than by layout pair.
			req.result.createObjectStore(BOARDS, { keyPath: "id" });
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
	for (const store of [STATS, SETTINGS, BOARDS]) {
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

export async function deleteBoard(id: string): Promise<void> {
	const db = await open();
	return new Promise((res, rej) => {
		const tx = db.transaction(BOARDS, "readwrite");
		tx.objectStore(BOARDS).delete(id);
		tx.oncomplete = () => res();
		tx.onerror = () => rej(tx.error);
	});
}
