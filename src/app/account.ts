import { auth } from "../atproto/auth.ts";
import { Sync, type SharedLayoutRow, type SyncState } from "../atproto/sync.ts";
import { layoutRecord, SHARED_PREFIX, type SessionRow } from "../atproto/records.ts";
import { allGeometries } from "../data/geometries.ts";
import { allKeymaps } from "../data/keymaps.ts";
import { applyRemoteProgress, layoutKey, loadSyncState, saveHistory, saveSyncState } from "../data/store.ts";
import { adoptShared, sharedLayout, type Layouts } from "./boards.ts";
import type { Geometry } from "../keyboard/types.ts";
import type { StatMap } from "../stats/stats.ts";

/** The page as the account layer sees it: read what is on screen, write back what the repo said. */
export type AccountHost = {
	read(): { geometryId: string; keymapId: string; targetCpm: number; stats: StatMap; sessions: SessionRow[]; layouts: Layouts };
	writeStats(stats: StatMap): void;
	writeSessions(sessions: SessionRow[]): void;
	writeLayouts(layouts: Layouts): void;
	writeGoal(targetCpm: number): void;
	/** Re-read the current layout from storage; the engine holds its own copy of the stats. */
	reload(): void;
	/** Change the selection through the page, so the open session closes on the old layout first. */
	pick(geometryId: string, keymapId: string): void;
	/** Adopt a selection quietly, at boot or on Sync, where nothing is mid-session. */
	select(geometryId: string, keymapId: string): void;
	/** Close the session that is open, so its characters reach the repo. */
	endSession(): Promise<void>;
	/** Something changed that the page must repaint. */
	invalidate(): void;
};

// SyncState lives in IndexedDB with everything else that has to survive a reload.
const syncStore = {
	load: () => loadSyncState(),
	// The store keeps one row; the spread is what makes it that row rather than a second one.
	save: async (s: SyncState) => saveSyncState(s),
};

/** The signed-in account, and the one line the sync layer is allowed to say out loud. */
export class Account {
	did = "";
	note = "";
	handle = "";
	#sync: Sync | undefined;

	constructor(readonly host: AccountHost) {}

	get connected(): boolean {
		return this.#sync !== undefined;
	}

	// Restore a session if this browser has one, and finish a sign-in redirect if one is in flight.
	async boot(): Promise<void> {
		try {
			const s = await auth.session();
			if (!s) return;
			this.did = s.did;
			this.#sync = new Sync(s, syncStore);
			await this.syncNow(false);
		} catch (err) {
			this.note = (err as Error).message;
		}
		this.host.invalidate();
	}

	async signIn(): Promise<void> {
		this.note = "";
		try {
			// One call, one authorisation request: asking twice would replace the PKCE state in storage and
			// the callback would no longer match the URL the browser was sent to.
			const url = await auth.authorizeUrl(this.handle);
			location.assign(url);
		} catch (err) {
			this.note = (err as Error).message;
		}
		this.host.invalidate();
	}

	async signOut(): Promise<void> {
		await this.host.endSession();
		await auth.signOut();
		this.did = "";
		this.#sync = undefined;
		this.note = "signed out; progress stays on this device";
		this.host.invalidate();
	}

	/** Bring the account and this browser into line, in whichever direction each piece is newer. */
	async syncNow(adapt = true): Promise<void> {
		const sync = this.#sync;
		if (!sync) return;
		const h = this.host;
		this.note = "";
		const read = h.read();
		const key = layoutKey(read.geometryId, read.keymapId);
		const notes: string[] = [];
		try {
			const { settings, progress, sessions, layouts } = await sync.pull();
			// Shared boards land before anything reads the settings record: the account may name a layout this
			// browser has never seen, and the adoption check below only accepts an id it can resolve.
			let adopted = read.layouts;
			for (const row of layouts) adopted = await adoptShared(row, adopted);
			if (adopted.boards.length !== read.layouts.boards.length || adopted.maps.length !== read.layouts.maps.length) h.writeLayouts(adopted);
			await saveHistory(sessions);
			h.writeSessions(sessions);
			const remote = progress[key];
			if (remote) {
				// Only what the record has learned since the last fold counts. It carries this browser's own
				// pushed numbers, so folding it in whole added our strokes to our strokes — once per sync. The
				// memory of what was already folded lives in the sync row, which store.ts reads and writes in
				// the same transaction as the stats.
				const before = JSON.stringify(read.stats);
				h.writeStats(await applyRemoteProgress(key, remote));
				if (JSON.stringify(h.read().stats) !== before) h.reload();
			}
			// Adopting a board mid-typing would yank it out from under the learner, so settings only cross
			// over on a quiet page: at boot, or when they press Sync.
			if (adapt && (settings.geometry || settings.keymap || settings.targetCpm)) {
				const now = h.read();
				// An id this browser cannot resolve is skipped, not adopted: the account may name a board whose
				// file never arrived, and selecting it would render a page with no keys on it.
				const g = settings.geometry && allGeometries().some((x) => x.id === settings.geometry) ? settings.geometry : now.geometryId;
				const k = settings.keymap && allKeymaps().some((x) => x.id === settings.keymap) ? settings.keymap : now.keymapId;
				if (settings.targetCpm) h.writeGoal(settings.targetCpm);
				if (g !== now.geometryId || k !== now.keymapId) h.select(g, k);
				else h.reload();
			}
		} catch (err) {
			// A failed read must not cancel the writes below. The reason this device has anything queued is
			// that a write failed earlier; if the read had to succeed first, an unreachable PDS would strand the
			// outbox forever.
			notes.push(`read failed: ${(err as Error).message}`);
		}
		const after = h.read();
		try {
			await sync.pushSettings({ geometry: after.geometryId, keymap: after.keymapId, targetCpm: after.targetCpm, unlocked: [] }, Date.now());
		} catch (err) {
			notes.push(`settings not sent: ${(err as Error).message}`);
		}
		const queued = await sync.flush(Date.now());
		this.note = [...notes, queued.error ?? (queued.sent ? `${queued.sent} session(s) sent` : "up to date")].join(" · ");
		h.invalidate();
	}

	/**
	 * Publish the layout on screen, then adopt the record this device just wrote. Adopting is not a courtesy
	 * to the other browser: without it this one keeps typing under `import:whatever` while the account says
	 * `shared:<rkey>`, and the two never recognize each other again.
	 */
	async publish(g: Geometry, keys: { id: string; char: string }[]): Promise<void> {
		const sync = this.#sync;
		if (!sync) return;
		this.note = "";
		try {
			const now = this.host.read();
			const rkey = await sync.pushLayout(layoutKey(now.geometryId, now.keymapId), layoutRecord(g.name, g.source, g, keys));
			const withShared = await adoptShared({ rkey, layout: sharedLayout(g, keys) } satisfies SharedLayoutRow, now.layouts);
			if (withShared.boards.length !== now.layouts.boards.length || withShared.maps.length !== now.layouts.maps.length) this.host.writeLayouts(withShared);
			const id = SHARED_PREFIX + rkey;
			this.host.pick(id, id);
			await this.syncNow(false);
			this.note = "layout published";
		} catch (err) {
			this.note = `layout not published: ${(err as Error).message}`;
		}
		this.host.invalidate();
	}

	/** One practice session, queued for the repo. Returns the line the learner should be told. */
	async pushSession(session: { chars: number; errors: number; ms: number; stats: StatMap }): Promise<{ sent?: number; error?: string }> {
		if (!this.#sync) return {};
		const { geometryId, keymapId } = this.host.read();
		return this.#sync.pushSession(layoutKey(geometryId, keymapId), session, Date.now());
	}
}
