// Which side wins a settings sync, with the page attached. The Sync here is real, over a fake PDS;
// the host is a stand-in for app-main that records the order the account's write callbacks arrive in.
import { describe, expect, it, vi } from "vitest";
import { LAYOUT, PROGRESS, SESSION, SETTINGS } from "../src/atproto/lexicons.ts";
import { Sync, emptyState, type SyncState, type SyncStore } from "../src/atproto/sync.ts";
import { Account, type AccountHost } from "../src/app/account.ts";
import type { Session } from "../src/atproto/auth.ts";
import type { StatMap } from "../src/stats/stats.ts";

// syncNow caches pulled sessions into IndexedDB; there is none in a node test and this is not the
// behavior under review. Everything else store.ts does here is pure object work.
vi.mock("../src/data/store.ts", async (importOriginal) => {
	const real = await importOriginal<typeof import("../src/data/store.ts")>();
	return { ...real, saveHistory: async () => undefined };
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
 *  layout on screen at the moment of the write — which is what makes write-before-select detectable. */
function fakeHost(start: { geometry: string; keymap: string; targetCpm: number; keyboardOrder: boolean; realWords: boolean }) {
	const log: string[] = [];
	const rows: Record<string, { geometry: string; keymap: string; targetCpm: number; keyboardOrder: boolean; realWords: boolean }> = { "go60+qwerty": { ...start }, "corne+workman": { geometry: "corne", keymap: "workman", targetCpm: 300, keyboardOrder: false, realWords: true } };
	let account: Account;
	const state = { geometryId: start.geometry, keymapId: start.keymap, targetCpm: start.targetCpm, keyboardOrder: start.keyboardOrder, realWords: start.realWords, stats: {} as StatMap, sessions: [] };
	const persist = () => {
		rows[`${state.geometryId}+${state.keymapId}`] = { geometry: state.geometryId, keymap: state.keymapId, targetCpm: state.targetCpm, keyboardOrder: state.keyboardOrder, realWords: state.realWords };
		void account.settingsChanged(); // what app-main's #saveSettings does after writing the row
	};
	const h: AccountHost = {
		read: () => ({ ...state, layouts: { boards: [], maps: [] } }),
		writeStats: () => undefined,
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
		},
		endSession: async () => undefined,
		invalidate: () => undefined,
	};
	return { host: h, log, rows, attach: (a: Account) => (account = a), state };
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
		expect(puts.filter((p) => p.collection === SETTINGS)).toEqual([]);
	});
});
