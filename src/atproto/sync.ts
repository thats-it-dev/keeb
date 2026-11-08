// Moving progress between this browser and a learner's atproto repo.
//
// Two rules. Nothing here is required for the app to work: every function throws, and the caller carries
// on as if there were no network. And the local copy stays authoritative while you type — sync happens
// around a session, never inside a keystroke, because a slow PDS must not show up as a slow typist.
import { PROGRESS, SESSION, SETTINGS } from "./lexicons.ts";
import { fromProgressRecord, fromSessionRecord, fromSettingsRecord, newKey, progressRecord, pruneSessions, sessionRecord, settingsRecord, type SessionRow } from "./records.ts";
import type { Settings } from "../data/store.ts";
import type { StatMap } from "../stats/stats.ts";
import type { Session } from "./auth.ts";

/** The bits of local state sync needs to remember between runs: which record belongs to which layout. */
export type SyncState = {
	progressRkeys: Record<string, string>;
	/** Sessions written locally but not yet accepted by a PDS. */
	outbox: { layout: string; chars: number; errors: number; ms: number; stats: StatMap }[];
	lastPull: number;
};

export const emptyState = (): SyncState => ({ progressRkeys: {}, outbox: [], lastPull: 0 });

export type SyncStore = { load(): Promise<SyncState>; save(s: SyncState): Promise<void> };

type StoredRecord = { uri: string; cid?: string; value: Record<string, unknown> };

/** The four XRPC calls this app makes, and nothing else. */
async function xrpc<T>(s: Session, method: string, path: string, params: Record<string, string | number> = {}, body?: unknown): Promise<T> {
	const q = Object.entries(params).length ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : "";
	const res = await s.fetchHandler(`/xrpc/${path}${q}`, {
		method,
		headers: body ? { "content-type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	// A PDS answers an error with JSON too, so the message has to come out of whichever body is there.
	const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
	if (!res.ok) throw new Error(`${path}: ${json.error ?? json.message ?? `HTTP ${res.status}`}`);
	return json as T;
}

async function list(s: Session, collection: string): Promise<StoredRecord[]> {
	const out: StoredRecord[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < 10 && (page === 0 || cursor); page += 1) {
		// `repo` is a required param of listRecords and a real PDS answers without it with
		// 400 InvalidRequest. The fake PDS in test/sync.test.ts used to ignore the param entirely, which is how
		// this shipped: every pull threw, and #syncNow aborted before it pushed anything.
		const res = await xrpc<{ records: StoredRecord[]; cursor?: string }>(s, "GET", "com.atproto.repo.listRecords", { repo: s.did, collection, limit: 100, ...(cursor ? { cursor } : {}) });
		out.push(...(res.records ?? []));
		cursor = res.cursor;
	}
	return out;
}

/**
 * putRecord with `validate: false`. Publishing the lexicons did NOT make this optional, which surprised
 * me: a Bluesky-hosted PDS only validates against schemas it has locally and does not fetch third-party
 * lexicons on demand, so omitting the flag fails the write outright with "Unknown lexicon type". With the
 * flag the record is stored and reported as validationStatus: "unknown", which is the accepted path for a
 * custom namespace. The shapes are still checked, just not by the PDS: test/lexicons.test.ts and
 * `goat lex validate` both run the real validator over these exact records.
 *
 * If you run your own PDS and add com.atproto.admin.importLexicons, this flag can go away.
 */
const put = (s: Session, collection: string, rkey: string, record: unknown) =>
	xrpc(s, "POST", "com.atproto.repo.putRecord", {}, { repo: s.did, collection, rkey, record, validate: false });

const del = (s: Session, collection: string, rkey: string) => xrpc(s, "POST", "com.atproto.repo.deleteRecord", {}, { repo: s.did, collection, rkey });

const rkeyOf = (uri: string): string => uri.slice(uri.lastIndexOf("/") + 1);

export class Sync {
	constructor(private s: Session, private store: SyncStore) {}

	/**
	 * Everything the network knows that this browser does not. Returns the settings to adopt, the progress
	 * to merge per layout, and every session the repo still keeps; the caller decides when local typing
	 * stops being in the way.
	 */
	async pull(): Promise<{ settings: Partial<Settings>; progress: Record<string, StatMap>; sessions: SessionRow[] }> {
		const state = await this.store.load();
		const [records, settings, sessions] = await Promise.all([list(this.s, PROGRESS), list(this.s, SETTINGS), list(this.s, SESSION)]);
		const progress: Record<string, StatMap> = {};
		const seen = new Map<string, number>();
		for (const rec of records) {
			const parsed = fromProgressRecord(rec.value);
			if (!parsed) continue;
			const stamp = typeof rec.value.updatedAt === "number" ? rec.value.updatedAt : 0;
			const best = seen.get(parsed.layout) ?? -1;
			// Two records for one layout is a normal accident (two browsers, both first-run). The newest
			// wins outright rather than being averaged with a stale one.
			if (stamp >= best) {
				seen.set(parsed.layout, stamp);
				progress[parsed.layout] = parsed.stats;
				state.progressRkeys[parsed.layout] = rkeyOf(rec.uri);
			}
		}
		state.lastPull = Math.round(Date.now() / 1000);
		await this.store.save(state);
		// The newest settings record wins. Picked rather than sorted: sorting mutates the array the caller
		// handed us nothing about, and one pass with a comparator says the same thing without the side effect.
		const newest = settings.reduce<{ at: number; value: Record<string, unknown> } | undefined>((top, r) => {
			const at = Number(r.value.updatedAt ?? 0);
			return !top || at >= top.at ? { at, value: r.value } : top;
		}, undefined);
		return {
			settings: fromSettingsRecord(newest?.value),
			progress,
			sessions: sessions.flatMap((r) => {
				const parsed = fromSessionRecord(r.value, rkeyOf(r.uri));
				return parsed ? [parsed] : [];
			}),
		};
	}

	async pushSettings(s: Settings, nowMs: number): Promise<void> {
		await put(this.s, SETTINGS, "self", settingsRecord(s, nowMs));
	}

	/**
	 * Publish a finished session and the progress it produced. Sessions are created, never overwritten:
	 * the tid is the record key, so the history is legible from the rkeys alone, and pruning is just
	 * deleting the oldest ones.
	 */
	async pushSession(layout: string, agg: { chars: number; errors: number; ms: number; stats: StatMap }, nowMs: number, cap = 50): Promise<{ sent: number; error?: string }> {
		const state = await this.store.load();
		state.outbox.push({ ...agg, layout });
		await this.store.save(state);
		return this.flush(nowMs, cap);
	}

	/** Anything that did not get out last time, oldest first. */
	async flush(nowMs: number, cap = 50): Promise<{ sent: number; error?: string }> {
		const state = await this.store.load();
		if (!state.outbox.length) return { sent: 0 };
		const queue = [...state.outbox];
		const sent: typeof queue = [];
		try {
			for (const item of queue) {
				await put(this.s, SESSION, newKey(), sessionRecord(item.layout, item));
				const rkey = state.progressRkeys[item.layout] ?? newKey();
				await put(this.s, PROGRESS, rkey, progressRecord(item.layout, item.stats, nowMs));
				state.progressRkeys[item.layout] = rkey;
				sent.push(item);
			}
		} catch (err) {
			// Keep what is still unsent. The next session, or the next online moment, tries again.
			state.outbox = state.outbox.filter((x) => !sent.includes(x));
			await this.store.save(state);
			return { sent: sent.length, error: (err as Error).message };
		}
		state.outbox = state.outbox.filter((x) => !sent.includes(x));
		await this.store.save(state);
		await this.#prune(cap);
		return { sent: sent.length };
	}

	async #prune(cap: number): Promise<void> {
		const records = await list(this.s, SESSION);
		const drop = pruneSessions(records.map((r) => ({ rkey: rkeyOf(r.uri), layout: String(r.value.layout ?? "") })), cap);
		for (const rkey of drop) {
			try {
				await del(this.s, SESSION, rkey);
			} catch {
				/* one failed delete is not worth losing the rest of the prune over */
			}
		}
	}
}
