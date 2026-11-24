// Which side wins a settings sync, with the page attached. The Sync here is real, over a fake PDS;
// the host is a stand-in for app-main that records the order the account's write callbacks arrive in.
import { describe, expect, it, vi } from "vitest";
import { LAYOUT, PROGRESS, SESSION, SETTINGS } from "../src/atproto/lexicons.ts";
import { Sync, emptyState, type SyncState, type SyncStore } from "../src/atproto/sync.ts";
import { Account, type AccountHost } from "../src/app/account.ts";
import type { Session } from "../src/atproto/auth.ts";
import { DEFAULT_SETTINGS } from "../src/data/store.ts";
import { mergeAll, type StatMap } from "../src/stats/stats.ts";

// syncNow caches pulled sessions into IndexedDB; there is none in a node test and this is not the
// behavior under review. Everything else store.ts does here is pure object work. applyRemoteProgress
// is mocked too: it merges under an IndexedDB row, which is store.ts's own contract, and the fold key
// — and the local stats a write returns — are what this file needs to see. The mock merges the page's
// own state, which is the honest shape of the real contract for an unseen fold (growth == remote).
const foldKeys = vi.hoisted(() => [] as string[]);
const foldState = vi.hoisted(() => ({ getStats: undefined as (() => StatMap) | undefined }));
vi.mock("../src/data/store.ts", async (importOriginal) => {
	const real = await importOriginal<typeof import("../src/data/store.ts")>();
	return {
		...real,
		saveHistory: async () => undefined,
		applyRemoteProgress: async (key: string, remote: StatMap) => {
			foldKeys.push(key);
			return mergeAll(foldState.getStats?.() ?? {}, remote);
		},
	};
});

const DID = "did:plc:example1234567890abcdefgh";

function fakePds(rows: Record<string, { uri: string; value: Record<string, unknown> }[]>) {
	const puts: { collection: string; rkey: string; record: Record<string, unknown> }[] = [];
	const session: Session = {
		did: DID,
		async fetchHandler(pathname, init) {
			const [full, query] = pathname.split("?");
			const path = full!.replace(/^\/xrpc\//, "");
			if (path === "com.atproto.repo.listRecords") {
				const params = Object.fromEntries(new URLSearchParams(query ?? ""));
				return json({ records: rows[params.collection!] ?? [] });
			}
			if (path === "com.atproto.repo.putRecord") {
				const body = JSON.parse(String(init?.body)) as { collection: string; rkey: string; record: Record<string, unknown> };
				puts.push(body);
				return json({ uri: `${DID}/${body.rkey}` });
			}
			return json({}, 400);
		},
	};
	return { session, puts };
}

const json = (value: unknown, status = 200) => ({ ok: status < 400, status, json: async () => value }) as Response;

const memStore = (initial: SyncState = emptyState()): SyncStore & { state: SyncState } => {
	const box = { state: initial };
	return {
		get state() {
			return box.state;
		},
		load: async () => box.state,
		save: async (s) => {
			box.state = s;
		},
	};
};

/** A page wired like app-main's host: each write persists the whole live state, under the key of the
 *  layout on screen at the moment of the write, and select reloads the fields from the new layout's row —
 *  which is what makes a write aimed at a half-loaded layout detectable. */
function fakeHost(start: { geometry: string; keymap: string; targetCpm: number; keyboardOrder: boolean; realWords: boolean }) {
	const log: string[] = [];
	const statsWrites: StatMap[] = [];
	const rows: Record<string, { geometry: string; keymap: string; targetCpm: number; keyboardOrder: boolean; realWords: boolean }> = { "go60+qwerty": { ...start }, "corne+workman": { geometry: "corne", keymap: "workman", targetCpm: 300, keyboardOrder: false, realWords: true } };
	let account: Account;
	const state = { geometryId: start.geometry, keymapId: start.keymap, targetCpm: start.targetCpm, keyboardOrder: start.keyboardOrder, realWords: start.realWords, stats: {} as StatMap, sessions: [] };
	// The mocked fold reads the page's own stats — exactly what the real IndexedDB-backed merge would see.
	foldState.getStats = () => state.stats;
	const persist = () => {
		rows[`${state.geometryId}+${state.keymapId}`] = { geometry: state.geometryId, keymap: state.keymapId, targetCpm: state.targetCpm, keyboardOrder: state.keyboardOrder, realWords: state.realWords };
		void account.settingsChanged(); // what app-main's #saveSettings does after writing the row
	};
	const h: AccountHost = {
		read: () => ({ ...state, layouts: { boards: [], maps: [] } }),
		writeStats: (stats: StatMap) => {
			state.stats = stats;
			statsWrites.push(stats);
		},
		writeSessions: () => undefined,
		writeLayouts: () => undefined,
		writeGoal: (cpm) => {
			state.targetCpm = cpm;
			log.push("writeGoal");
			persist();
		},
		writeCurriculum: (curriculum) => {
			state.keyboardOrder = curriculum.keyboardOrder ?? state.keyboardOrder;
			state.realWords = curriculum.realWords ?? state.realWords;
			log.push("writeCurriculum");
			persist();
		},
		reload: () => log.push("reload"),
		pick: () => undefined,
		select: (g, k) => {
			state.geometryId = g;
			state.keymapId = k;
			log.push("select");
			// Like app-main, the row's load resolves after a storage trip: a write that skips awaiting
			// select lands before these fields turn over, and lands the wrong layout's values on the new row.
			return Promise.resolve().then(() => {
				const row = rows[`${g}+${k}`];
				state.targetCpm = row?.targetCpm ?? DEFAULT_SETTINGS.targetCpm;
				state.keyboardOrder = row?.keyboardOrder ?? DEFAULT_SETTINGS.keyboardOrder;
				state.realWords = row?.realWords ?? DEFAULT_SETTINGS.realWords;
			});
		},
		endSession: async () => undefined,
		invalidate: () => undefined,
	};
	return { host: h, log, rows, statsWrites, attach: (a: Account) => (account = a), state };
}

const at = () => Math.round(Date.now() / 1000);

describe("account settings sync", () => {
	it("adopts a newer record onto the layout it selects, before writing its numbers, and echoes nothing", async () => {
		const stamp = at();
		const { session, puts } = fakePds({
			[SETTINGS]: [{ uri: `${DID}/${SETTINGS}/self`, value: { $type: SETTINGS, geometry: "corne", keymap: "workman", targetCpm: 240, keyboardOrder: true, realWords: false, updatedAt: stamp } }],
		});
		const store = memStore();
		const page = fakeHost({ geometry: "go60", keymap: "qwerty", targetCpm: 200, keyboardOrder: false, realWords: false });
		const account = new Account(page.host, new Sync(session, store));
		page.attach(account);
		await account.syncNow();
		// Select first, then write — so the adopted goal persists under the NEW layout's row.
		expect(page.log.slice(0, 3)).toEqual(["select", "writeGoal", "writeCurriculum"]);
		expect(page.rows["corne+workman"]).toMatchObject({ targetCpm: 240, keyboardOrder: true });
		expect(page.rows["go60+qwerty"]!.targetCpm).toBe(200); // the row being left keeps its own goal
		// No echo: neither mid-adopt nor the trailing push may PUT a settings record this sync just applied.
		expect(puts.filter((p) => p.collection === SETTINGS)).toEqual([]);
		expect(store.state.settingsLocalAt).toBe(stamp);
	});

	it("pushes a newer local edit instead of adopting the stale record", async () => {
		const { session, puts } = fakePds({
			[SETTINGS]: [{ uri: `${DID}/${SETTINGS}/self`, value: { $type: SETTINGS, geometry: "go60", keymap: "qwerty", targetCpm: 150, keyboardOrder: false, realWords: false, updatedAt: at() - 3600 } }],
		});
		const store = memStore();
		store.state.settingsLocalAt = at(); // the learner changed the goal on this device an hour later
		const page = fakeHost({ geometry: "go60", keymap: "qwerty", targetCpm: 250, keyboardOrder: false, realWords: false });
		const account = new Account(page.host, new Sync(session, store));
		page.attach(account);
		await account.syncNow();
		expect(page.log).toEqual([]); // nothing was adopted over the local value
		const sent = puts.filter((p) => p.collection === SETTINGS);
		expect(sent).toHaveLength(1);
		expect(sent[0]!.record).toMatchObject({ targetCpm: 250 });
	});

	it("an edit made while the sync page is open pushes once and is not echoed twice", async () => {
		const { session, puts } = fakePds({});
		const store = memStore();
		const page = fakeHost({ geometry: "go60", keymap: "qwerty", targetCpm: 200, keyboardOrder: false, realWords: false });
		const account = new Account(page.host, new Sync(session, store));
		page.attach(account);
		await account.syncNow(); // boot: no record yet, the trailing push creates one
		await account.settingsChanged(); // the learner blurs the goal field
		const sent = puts.filter((p) => p.collection === SETTINGS);
		expect(sent).toHaveLength(2);
		expect(sent[1]!.record.targetCpm).toBe(200);
	});

	it("a record predating the switches carries no opinion about them and writes no curriculum", async () => {
		const stamp = at();
		const { session, puts } = fakePds({
			[SETTINGS]: [{ uri: `${DID}/${SETTINGS}/self`, value: { $type: SETTINGS, geometry: "corne", keymap: "workman", targetCpm: 240, updatedAt: stamp } }],
		});
		const store = memStore();
		const page = fakeHost({ geometry: "go60", keymap: "qwerty", targetCpm: 200, keyboardOrder: false, realWords: false });
		const account = new Account(page.host, new Sync(session, store));
		page.attach(account);
		await account.syncNow();
		expect(page.log).toEqual(["select", "writeGoal"]); // writeCurriculum is not called for absent fields
		expect(page.rows["corne+workman"]!.targetCpm).toBe(240);
		expect(page.rows["corne+workman"]).toMatchObject({ keyboardOrder: false, realWords: true }); // the row's own switches survive the adopt
		expect(puts.filter((p) => p.collection === SETTINGS)).toEqual([]);
	});
});

describe("fresh login", () => {
	it("adopts the record and folds progress under the adopted layout", async () => {
		const stamp = at();
		const { session, puts } = fakePds({
			[SETTINGS]: [{ uri: `${DID}/${SETTINGS}/self`, value: { $type: SETTINGS, geometry: "corne", keymap: "workman", targetCpm: 240, keyboardOrder: true, realWords: false, updatedAt: stamp } }],
			[PROGRESS]: [{ uri: `at://${DID}/${PROGRESS}/5555`, value: { $type: PROGRESS, layout: "corne+workman", stats: [{ keyId: "a", ttMs16: 3200, bestMs16: 2800, samples: 40, errors: 1 }], updatedAt: stamp } }],
		});
		const store = memStore();
		foldKeys.length = 0;
		const page = fakeHost({ geometry: "go60", keymap: "qwerty", targetCpm: 200, keyboardOrder: false, realWords: false });
		const account = new Account(page.host, new Sync(session, store));
		page.attach(account);
		await account.syncNow(true); // the shape a fresh login passes
		// The fold runs under the LAYOUT ADOPTED BY THIS SYNC, not the one the device opened on.
		expect(foldKeys).toEqual(["corne+workman"]);
		expect(page.statsWrites).toHaveLength(1);
		expect(page.statsWrites[0]).toEqual({ a: { ttMs16: 3200, bestMs16: 2800, samples: 40, errors: 1 } });
		expect(page.log.slice(0, 3)).toEqual(["select", "writeGoal", "writeCurriculum"]);
		expect(page.rows["corne+workman"]).toMatchObject({ targetCpm: 240, keyboardOrder: true });
		// No echo: the record this sync just applied is not PUT back.
		expect(puts.filter((p) => p.collection === SETTINGS)).toEqual([]);
	});

	it("a plain boot leaves the layout alone but still folds progress under the current one", async () => {
		const stamp = at();
		const { session } = fakePds({
			[PROGRESS]: [{ uri: `at://${DID}/${PROGRESS}/5555`, value: { $type: PROGRESS, layout: "go60+qwerty", stats: [{ keyId: "b", ttMs16: 12, bestMs16: 12, samples: 1, errors: 0 }], updatedAt: stamp } }],
		});
		const store = memStore();
		foldKeys.length = 0;
		const page = fakeHost({ geometry: "go60", keymap: "qwerty", targetCpm: 200, keyboardOrder: false, realWords: false });
		const account = new Account(page.host, new Sync(session, store));
		page.attach(account);
		await account.syncNow(false); // what boot passes for a stored session
		expect(foldKeys).toEqual(["go60+qwerty"]);
		expect(page.statsWrites[0]).toMatchObject({ b: expect.objectContaining({ samples: 1 }) });
		expect(page.log).toContain("reload"); // the merged stats reload onto the live page
		expect(page.log).not.toContain("select"); // no layout adopted on a plain boot
	});

	it("never strands the device's own typed progress: a device with local stats keeps its layout", async () => {
		const stamp = at();
		const { session } = fakePds({
			[SETTINGS]: [{ uri: `${DID}/${SETTINGS}/self`, value: { $type: SETTINGS, geometry: "corne", keymap: "workman", targetCpm: 240, keyboardOrder: true, realWords: false, updatedAt: stamp } }],
			[PROGRESS]: [
				{ uri: `at://${DID}/${PROGRESS}/5555`, value: { $type: PROGRESS, layout: "corne+workman", stats: [{ keyId: "a", ttMs16: 3200, bestMs16: 2800, samples: 40, errors: 1 }], updatedAt: stamp } },
				{ uri: `at://${DID}/${PROGRESS}/4444`, value: { $type: PROGRESS, layout: "go60+qwerty", stats: [{ keyId: "b", ttMs16: 100, bestMs16: 100, samples: 5, errors: 0 }], updatedAt: stamp } },
			],
		});
		const store = memStore();
		foldKeys.length = 0;
		const page = fakeHost({ geometry: "go60", keymap: "qwerty", targetCpm: 200, keyboardOrder: false, realWords: false });
		const account = new Account(page.host, new Sync(session, store));
		page.attach(account);
		// The device typed on go60+qwerty before signing in. Those numbers live in the page's own
		// state; an adopt onto the account's layout would throw them away behind a board the device
		// may never select again.
		page.state.stats = { a: { ttMs16: 3500, bestMs16: 2900, samples: 25, errors: 2 } };
		await account.syncNow(true); // the shape a fresh login passes
		expect(page.log).not.toContain("select"); // the adopt keeps the device on its own layout
		expect(foldKeys).toEqual(["go60+qwerty"]); // the fold runs under the layout that is on screen
		// The device's own typed numbers survive the fold: the local sample count is still there, the
		// record's growth is folded in beside it.
		expect(page.state.stats.a?.samples).toBe(25);
		expect(page.state.stats.b?.samples).toBe(5);
		expect(page.rows["go60+qwerty"]).toMatchObject({ targetCpm: 200 }); // the local goal is untouched
	});

	it("keeps the fold alive when the adopt fails", async () => {
		const stamp = at();
		const { session } = fakePds({
			[SETTINGS]: [{ uri: `${DID}/${SETTINGS}/self`, value: { $type: SETTINGS, geometry: "corne", keymap: "workman", targetCpm: 240, keyboardOrder: true, realWords: false, updatedAt: stamp } }],
			[PROGRESS]: [{ uri: `at://${DID}/${PROGRESS}/5555`, value: { $type: PROGRESS, layout: "corne+workman", stats: [{ keyId: "a", ttMs16: 3200, bestMs16: 2800, samples: 40, errors: 1 }], updatedAt: stamp } }],
		});
		const store = memStore();
		foldKeys.length = 0;
		const page = fakeHost({ geometry: "go60", keymap: "qwerty", targetCpm: 200, keyboardOrder: false, realWords: false });
		const account = new Account(page.host, new Sync(session, store));
		page.attach(account);
		// A select that rejects: the row load fails and the adopt dies part-way, after the ids moved.
		// The fold must still merge the account's progress into the layout on screen.
		page.host.select = (g, k) => {
			page.state.geometryId = g;
			page.state.keymapId = k;
			return Promise.reject(new Error("row load failed"));
		};
		await account.syncNow(true);
		expect(account.note).toContain("adopt failed"); // the failure is reported, not swallowed
		expect(page.log).not.toContain("writeGoal"); // the failed adopt never writes
		expect(foldKeys).toEqual(["corne+workman"]); // the fold still runs under the layout on screen
		expect(page.state.stats.a?.samples).toBe(40); // the record's numbers, merged in
	});
});
