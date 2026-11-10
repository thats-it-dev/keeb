// M4: what sync sends and what it keeps when a PDS is unreachable. The session is a fake that records
// every XRPC call, so the assertions are about the wire, not about the object graph.
import { describe, expect, it } from "vitest";
import { LAYOUT, PROGRESS, SESSION, SETTINGS } from "../src/atproto/lexicons.ts";
import { Sync, emptyState, type SyncState, type SyncStore } from "../src/atproto/sync.ts";
import { foldProgress, newKey } from "../src/atproto/records.ts";
import type { Session } from "../src/atproto/auth.ts";
import type { StatMap } from "../src/stats/stats.ts";

type Call = { path: string; params: Record<string, string>; body?: Record<string, unknown> };

const DID = "did:plc:example1234567890abcdefgh";

/** Params a real PDS refuses to answer without. Validating them here is the thing that was missing: the fake
 *  used to ignore the query string entirely, so pull() calling listRecords without `repo` answered 200 and
 *  every test stayed green while production returned 400 InvalidRequest on every single read. */
const REQUIRED: Record<string, string[]> = {
	"com.atproto.repo.listRecords": ["repo", "collection"],
	"com.atproto.repo.putRecord": ["repo", "collection", "rkey"],
	"com.atproto.repo.deleteRecord": ["repo", "collection", "rkey"],
};

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
			// GET carries params in the query, POST in the body -- the real endpoints differ here too.
			const field = (k: string) => (init?.method === "GET" || !body ? params[k] : body[k] === undefined ? undefined : String(body[k]));
			const missing = (REQUIRED[path ?? ""] ?? []).filter((k) => !field(k));
			if (missing.length) return jsonResponse(400, { error: "InvalidRequest", message: `Invalid ${path} params: Missing required key "${missing[0]}"` });
			if (path === "com.atproto.repo.listRecords") return jsonResponse(200, { records: rows[params.collection!] ?? [] });
			if (path === "com.atproto.repo.putRecord") {
				stored[`${body?.collection ?? ""}/${body?.rkey ?? ""}`] = body?.record as Record<string, unknown>;
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

/**
 * Replay this test's writes into its listings.
 *
 * A real repo answers a pull with whatever a push put there; this fake used to keep the two apart, which is
 * why no test could describe a round trip — and a round trip is exactly where progress started doubling.
 */
function commit(rows: Record<string, { uri: string; value: Record<string, unknown> }[]>, calls: Call[]) {
	for (const c of calls) {
		if (c.path !== "com.atproto.repo.putRecord") continue;
		const col = String(c.body?.collection);
		const uri = `at://${DID}/${col}/${String(c.body?.rkey)}`;
		const list = rows[col] ?? [];
		rows[col] = list;
		const value = c.body?.record as Record<string, unknown>;
		const at = list.findIndex((x) => x.uri === uri);
		if (at >= 0) list[at] = { uri, value };
		else list.push({ uri, value });
	}
	calls.length = 0;
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

	it("pulls the sessions the repo keeps, dated from their rkey", async () => {
		const tid = newKey();
		const { session } = fake({
			[SESSION]: [
				{ uri: `at://${DID}/${SESSION}/${tid}`, value: { $type: SESSION, layout: "go60+qwerty", chars: 500, errors: 3, ms: 61_000, stats: [] } },
				{ uri: `at://${DID}/${SESSION}/self`, value: { $type: SESSION, layout: "go60+qwerty", chars: 10, errors: 0, ms: 1000, stats: [] } },
				{ uri: `at://${DID}/${PROGRESS}/wrong`, value: { $type: PROGRESS, layout: "x", stats: [], updatedAt: 1 } },
			],
		});
		const res = await new Sync(session, memStore()).pull();
		expect(res.sessions.length).toBe(2); // a record of another type in the listing is skipped
		expect(res.sessions[0]).toMatchObject({ rkey: tid, layout: "go60+qwerty", chars: 500, errors: 3, ms: 61_000 });
		expect(res.sessions[0]!.atMs).toBeGreaterThan(0);
		// A rkey that is not a tid still counts in the totals; it simply cannot be placed on a day.
		expect(res.sessions[1]!.atMs).toBe(0);
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

	it("writes a session and its progress with validate:false, the only way a hosted PDS accepts these", async () => {
		// Publishing the lexicons did not change this. A Bluesky-hosted PDS validates only against schemas
		// it holds locally and will not fetch a third-party lexicon on demand, so dropping the flag fails
		// the write with "Unknown lexicon type". Asserting the flag is present, because a future reader
		// tidyming it away would break every write and no other test would catch it.
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

	it("does not count the progress it pushed itself as new evidence", async () => {
		// The bug: pushSession writes this browser's whole stat map into the layout's PROGRESS record, and the
		// next pull hands that same map back as if it came from somewhere else. Folding it in added our own
		// ten strokes to our own ten strokes, and every sync after that doubled the count again.
		const rows = { [SESSION]: [], [PROGRESS]: [], [SETTINGS]: [], [LAYOUT]: [] };
		const { session, calls } = fake(rows);
		const store = memStore();
		const sync = new Sync(session, store);
		const L = "go60+qwerty";
		let local: StatMap = { a: { ttMs16: 3200, samples: 10, errors: 2 } }; // ten strokes at 200ms, two typos
		await sync.pushSession(L, { chars: 10, errors: 2, ms: 3_000, stats: local }, Date.now());
		commit(rows, calls);
		for (let round = 0; round < 3; round += 1) {
			const { progress } = await sync.pull();
			const merged = foldProgress(local, store.state.progressSeen?.[L], progress[L]);
			// What the app's store write does, in the same transaction as the stats it saves.
			await store.save({ ...store.state, progressSeen: { ...store.state.progressSeen, [L]: progress[L]! } });
			expect(merged.a!.samples).toBe(10);
			local = merged;
		}
		expect(local.a).toEqual({ ttMs16: 3200, samples: 10, errors: 2 });
	});

	it("counts what another device added since the last sync, once", async () => {
		const now = Math.round(Date.now() / 1000);
		const rec = (samples: number, ttMs16: number, errors: number) => ({
			uri: `at://${DID}/${PROGRESS}/2222other`,
			value: { $type: PROGRESS, layout: "go60+qwerty", stats: [{ keyId: "a", ttMs16, samples, errors }], updatedAt: now },
		});
		const rows = { [SESSION]: [], [PROGRESS]: [rec(10, 4000, 1)], [SETTINGS]: [], [LAYOUT]: [] };
		const { session } = fake(rows);
		const store = memStore();
		const sync = new Sync(session, store);
		let local: StatMap = { a: { ttMs16: 1600, samples: 10, errors: 0 } }; // this device: 10 strokes at 100ms
		const round = async () => {
			const { progress } = await sync.pull();
			const remote = progress["go60+qwerty"]!;
			local = foldProgress(local, store.state.progressSeen?.["go60+qwerty"], remote);
			await store.save({ ...store.state, progressSeen: { ...store.state.progressSeen, "go60+qwerty": remote } });
		};
		await round();
		expect(local.a).toEqual({ ttMs16: 2800, samples: 20, errors: 1 }); // 100ms and 250ms, evenly weighted
		rows[PROGRESS] = [rec(30, 3840, 3)]; // the other device practises: 20 more strokes
		await round();
		await round(); // and says nothing the second time
		expect(local.a!.samples).toBe(40); // 10 here + 10 + 20 there, not 70
		expect(local.a!.errors).toBe(3);
		expect(Math.round(local.a!.ttMs16 / 16)).toBe(205);
	});

	it("says which record it could not read rather than inventing one", async () => {
		const { session } = fake({ [SESSION]: [], [PROGRESS]: [], [SETTINGS]: [] });
		const bad = { ...session, fetchHandler: async () => jsonResponse(400, { error: "InvalidRequest", message: "no such collection" }) };
		await expect(new Sync(bad, memStore()).pull()).rejects.toThrow(/InvalidRequest|no such collection/);
	});

	it("publishes a layout and keeps one record per layout rather than one per press", async () => {
		const rec = { $type: LAYOUT, name: "Go60", source: "manual", geometry: { keys: [{ keyId: "k1", hand: "l", row: 2, col: 1, x: 100, y: 200, w: 100, h: 100, rot: 0, label: "a" }] }, charMap: { chars: [{ keyId: "k1", char: "a" }] } };
		const rows = { [SESSION]: [], [PROGRESS]: [], [SETTINGS]: [], [LAYOUT]: [] };
		const { session, calls, stored } = fake(rows);
		const sync = new Sync(session, memStore());
		const first = await sync.pushLayout("go60+qwerty", rec as never);
		const second = await sync.pushLayout("go60+qwerty", rec as never);
		expect(second).toBe(first); // reusing the rkey is what makes an adopted layout's id stable
		const puts = calls.filter((c) => c.path === "com.atproto.repo.putRecord" && c.body?.collection === LAYOUT);
		expect(puts.map((p) => p.body?.rkey)).toEqual([first, first]);
		expect(Object.keys(stored)).toEqual([`${LAYOUT}/${first}`]);
	});

	it("brings shared layouts back ordered by tid, skipping what is not one", async () => {
		const lay = (rkey: string, name: string) => ({ uri: `at://${DID}/${LAYOUT}/${rkey}`, value: { $type: LAYOUT, name, source: "s", geometry: { keys: [{ keyId: "k1", hand: "l", row: 1, col: 1, x: 100, y: 0, w: 100, h: 100, rot: 0, label: "" }] }, charMap: { chars: [{ keyId: "k1", char: "q" }] } } });
		const rows = { [SESSION]: [], [PROGRESS]: [], [SETTINGS]: [], [LAYOUT]: [lay("5555newer", "Newer"), lay("1111older", "Older"), { uri: `at://${DID}/${LAYOUT}/9999junk`, value: { $type: PROGRESS } }] };
		const { session } = fake(rows);
		const res = await new Sync(session, memStore()).pull();
		expect(res.layouts.map((l) => l.layout.name)).toEqual(["Older", "Newer"]);
		expect(res.layouts[0]!.rkey).toBe("1111older");
		expect(res.layouts[0]!.layout.byKey.k1).toBe("q");
	});

});
