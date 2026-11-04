// M4: what sync sends and what it keeps when a PDS is unreachable. The session is a fake that records
// every XRPC call, so the assertions are about the wire, not about the object graph.
import { describe, expect, it } from "vitest";
import { PROGRESS, SESSION, SETTINGS } from "../src/atproto/lexicons.ts";
import { Sync, emptyState, type SyncState, type SyncStore } from "../src/atproto/sync.ts";
import { newKey } from "../src/atproto/records.ts";
import type { Session } from "../src/atproto/auth.ts";
import type { StatMap } from "../src/stats/stats.ts";

type Call = { path: string; params: Record<string, string>; body?: Record<string, unknown> };

const DID = "did:plc:example1234567890abcdefgh";

/** A PDS that answers from a map of collection -> records, and remembers what it was asked to do. */
function fake(rows: Record<string, { uri: string; value: Record<string, unknown> }[]>, fail = false) {
	const calls: Call[] = [];
	const stored: Record<string, Record<string, unknown>> = {};
	const session: Session = {
		did: DID,
		async fetchHandler(pathname, init) {
			const [full, query] = pathname.split("?");
			const path = full!.replace(/^\/xrpc\//, ""); // sync.ts calls the endpoint by its namespaced name
			const params = Object.fromEntries(new URLSearchParams(query ?? ""));
			const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
			calls.push({ path: path!, params, body });
			if (fail) return jsonResponse(502, { error: "ServiceUnavailable", message: "pds is down" });
			if (path === "com.atproto.repo.listRecords") return jsonResponse(200, { records: rows[params.collection!] ?? [] });
			if (path === "com.atproto.repo.putRecord") {
				stored[`${params.collection ?? ""}/${body?.rkey ?? ""}`] = body?.record as Record<string, unknown>;
				return jsonResponse(200, { uri: `${DID}/${body?.rkey}`, cid: "bafy" });
			}
			if (path === "com.atproto.repo.deleteRecord") {
				const list = rows[body!.collection as string];
				rows[body!.collection as string] = (list ?? []).filter((x) => !x.uri.endsWith(`/${body!.rkey}`));
				return jsonResponse(200, {});
			}
			return jsonResponse(400, { error: "UnknownRoute" });
		},
	};
	return { session, calls, stored };
}

function jsonResponse(status: number, json: unknown): Response {
	return { ok: status < 400, status, json: async () => json } as Response;
}

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

const stats = (id: string, ttMs16: number, samples: number): StatMap => ({ [id]: { ttMs16, samples, errors: 0 } });

describe("sync", () => {
	it("pulls progress and settings from the repo", async () => {
		const now = Math.round(Date.now() / 1000);
		const { session } = fake({
			[PROGRESS]: [{ uri: `at://${DID}/${PROGRESS}/2222abc`, value: { $type: PROGRESS, layout: "go60+qwerty", stats: [{ keyId: "a", ttMs16: 3200, samples: 10, errors: 1 }], updatedAt: now } }],
			[SETTINGS]: [{ uri: `at://${DID}/${SETTINGS}/self`, value: { $type: SETTINGS, geometry: "corne", keymap: "workman", targetCpm: 240, unlocked: ["a"], updatedAt: now } }],
		});
		const store = memStore();
		const res = await new Sync(session, store).pull();
		expect(res.progress["go60+qwerty"]).toEqual({ a: { ttMs16: 3200, samples: 10, errors: 1 } });
		expect(res.settings).toEqual({ geometry: "corne", keymap: "workman", targetCpm: 240, unlocked: ["a"] });
		// The rkey is remembered, so the next push updates that record instead of starting a second one.
		expect(store.state.progressRkeys["go60+qwerty"]).toBe("2222abc");
	});

	it("takes the newest of two progress records for one layout instead of averaging them", async () => {
		const now = Math.round(Date.now() / 1000);
		const { session } = fake({
			[PROGRESS]: [
				{ uri: `at://${DID}/${PROGRESS}/3333new`, value: { $type: PROGRESS, layout: "go60+qwerty", stats: [{ keyId: "a", ttMs16: 9000, samples: 4, errors: 0 }], updatedAt: now } },
				{ uri: `at://${DID}/${PROGRESS}/1111old`, value: { $type: PROGRESS, layout: "go60+qwerty", stats: [{ keyId: "a", ttMs16: 100, samples: 900, errors: 0 }], updatedAt: now - 500 } },
			],
			[SETTINGS]: [],
		});
		const res = await new Sync(session, memStore()).pull();
		expect(res.progress["go60+qwerty"]!.a!.samples).toBe(4);
	});

	it("pulls a progress record written before the id field was renamed", async () => {
		// Nothing rewrites a learner's existing records, so a pull has to understand the older row shape
		// or their practice history would come back empty without saying so.
		const { session } = fake({
			[PROGRESS]: [{ uri: `at://${DID}/${PROGRESS}/4444legacy`, value: { $type: PROGRESS, layout: "go60+qwerty", stats: [{ id: "a", ttMs16: 2000, samples: 7, errors: 0 }], updatedAt: Math.round(Date.now() / 1000) } }],
			[SETTINGS]: [],
			[SESSION]: [],
		});
		const res = await new Sync(session, memStore()).pull();
		expect(res.progress["go60+qwerty"]).toEqual({ a: { ttMs16: 2000, samples: 7, errors: 0 } });
	});

	it("writes a session and its progress without asking the PDS to validate", async () => {
		const { session, calls, stored } = fake({ [SESSION]: [], [PROGRESS]: [], [SETTINGS]: [] });
		const store = memStore();
		const sync = new Sync(session, store);
		await sync.pushSession("go60+qwerty", { chars: 120, errors: 3, ms: 40_000, stats: stats("a", 3200, 12) }, Date.now());
		const puts = calls.filter((c) => c.path === "com.atproto.repo.putRecord");
		expect(puts.map((c) => c.body?.collection).sort()).toEqual([PROGRESS, SESSION].sort());
		expect(puts.every((c) => c.body?.validate === false)).toBe(true);
		expect(puts.every((c) => c.body?.repo === DID)).toBe(true);
		expect(Object.values(stored).some((v) => (v as { chars?: number }).chars === 120)).toBe(true);
	});

	it("reuses one progress record per layout across sessions", async () => {
		const { session, calls } = fake({ [SESSION]: [], [PROGRESS]: [], [SETTINGS]: [] });
		const store = memStore();
		const sync = new Sync(session, store);
		await sync.pushSession("go60+qwerty", { chars: 10, errors: 0, ms: 3000, stats: stats("a", 1000, 2) }, Date.now());
		const rkey = store.state.progressRkeys["go60+qwerty"];
		await sync.pushSession("go60+qwerty", { chars: 10, errors: 0, ms: 3000, stats: stats("a", 1000, 2) }, Date.now());
		expect(store.state.progressRkeys["go60+qwerty"]).toBe(rkey);
		const progressPuts = calls.filter((c) => c.path === "com.atproto.repo.putRecord" && c.body?.collection === PROGRESS);
		expect(progressPuts.map((c) => c.body?.rkey)).toEqual([rkey, rkey]);
	});

	it("keeps unsent sessions while the PDS is down and flushes them later", async () => {
		const down = fake({ [SESSION]: [], [PROGRESS]: [], [SETTINGS]: [] }, true);
		const store = memStore();
		const sync = new Sync(down.session, store);
		await sync.pushSession("go60+qwerty", { chars: 5, errors: 0, ms: 1000, stats: stats("a", 1, 1) }, Date.now());
		expect(store.state.outbox.length).toBe(1);
		expect(down.calls.some((c) => c.path === "com.atproto.repo.deleteRecord")).toBe(false);

		const up = fake({ [SESSION]: [], [PROGRESS]: [], [SETTINGS]: [] });
		const back = new Sync(up.session, store);
		const res = await back.flush(Date.now());
		expect(res).toEqual({ sent: 1 });
		expect(store.state.outbox).toEqual([]);
		expect(up.calls.filter((c) => c.path === "com.atproto.repo.putRecord").length).toBe(2);
	});

	it("prunes the oldest sessions past the cap, and only its own layout's", async () => {
		const tids = Array.from({ length: 7 }, () => newKey()); // distinct, and time-ordered as strings
		const rows = {
			[SESSION]: [
				...tids.map((t, i) => ({ uri: `at://${DID}/${SESSION}/${t}`, value: { $type: SESSION, layout: "go60+qwerty", chars: i, errors: 0, ms: i, stats: [] } })),
				{ uri: `at://${DID}/${SESSION}/zzzz0000000`, value: { $type: SESSION, layout: "corne+qwerty", chars: 1, errors: 0, ms: 1, stats: [] } },
			],
			[PROGRESS]: [],
			[SETTINGS]: [],
		};
		const { session, calls } = fake(rows);
		const sync = new Sync(session, memStore());
		await sync.pushSession("go60+qwerty", { chars: 1, errors: 0, ms: 1, stats: stats("a", 1, 1) }, Date.now(), 5);
		const deleted = calls.filter((c) => c.path === "com.atproto.repo.deleteRecord").map((c) => String(c.body?.rkey));
		// Six existing plus the new one is seven for that layout, cap 5: the two oldest go.
		expect(deleted.sort()).toEqual([tids[0], tids[1]].sort());
		expect(deleted).not.toContain("zzzz0000000");
	});

	it("says which record it could not read rather than inventing one", async () => {
		const { session } = fake({ [SESSION]: [], [PROGRESS]: [], [SETTINGS]: [] });
		const bad = { ...session, fetchHandler: async () => jsonResponse(400, { error: "InvalidRequest", message: "no such collection" }) };
		await expect(new Sync(bad, memStore()).pull()).rejects.toThrow(/InvalidRequest|no such collection/);
	});
});
