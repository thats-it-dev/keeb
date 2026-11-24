// Orphaned progress: stats and settings rows whose layout was deleted. This module is the one path that
// folds the rows into a surviving layout — detection, target picks, and remap — so the page only wires.
import { orphanKeys, remapOrphan, type OrphanRef } from "./repair.ts";
import { allGeometries } from "../data/geometries.ts";
import { allKeymaps } from "../data/keymaps.ts";
import { layoutKey, loadStatsAll, loadSettingsAll, loadSettingsRaw, loadStats, mergeAndDelete } from "../data/store.ts";

/** The injectable seam: every side effect the page would do is reachable here, so the control can be
 *  exercised in a unit test without IndexedDB. */
export type OrphanControlDeps = {
	loadKeys(): Promise<{ stats: string[]; settings: string[] }>;
	geometries(): { id: string }[];
	keymaps(): { id: string }[];
	fold(orphanKey: string, geometryId: string, keymapId: string): Promise<void>;
};

const defaultDeps: OrphanControlDeps = {
	loadKeys: async () => {
		const [statRows, settingsRows] = await Promise.all([loadStatsAll(), loadSettingsAll()]);
		return { stats: statRows.map((r) => r.key), settings: settingsRows.map((r) => r.key) };
	},
	geometries: () => allGeometries(),
	keymaps: () => allKeymaps(),
	fold: async (orphanKey, geometryId, keymapId) => {
		await remapOrphan(orphanKey, geometryId, keymapId, { loadStats, loadSettingsRaw, mergeAndDelete });
	},
};

export class OrphanControl {
	orphans: OrphanRef[] = [];
	/** The most recent fold or check failure, shown in the dialog. Cleared by the next clean run. */
	error: string | undefined;
	#folding = new Set<string>();
	/** The board+keymap a learner picked per orphan, kept so a re-render never resets the pick. */
	targets: Record<string, { g: string; k: string }> = {};
	#changed: () => void;
	#deps: OrphanControlDeps;

	constructor(changed: () => void, deps: OrphanControlDeps = defaultDeps) {
		this.#changed = changed;
		this.#deps = deps;
	}

	/** True while any fold is in flight: the whole row set is disabled, because one slow fold would race
	 *  a second against itself on the same target. */
	get anyFolding(): boolean {
		return this.#folding.size > 0;
	}

	targetOf(key: string, current: { g: string; k: string }): { g: string; k: string } {
		return this.targets[key] ?? current;
	}

	pickTarget(key: string, part: "g" | "k", value: string, current: { g: string; k: string }): void {
		const cur = this.targetOf(key, current);
		this.targets[key] = part === "g" ? { ...cur, g: value } : { ...cur, k: value };
	}

	/** Fold the orphan the learner picked into a surviving layout. The pick is validated against live ids;
	 *  a stale pick (deleted board or keymap) is replaced with the current selection, never written. */
	remapFor(orphanKey: string, currentGeometry: string, currentKeymap: string, reload: () => Promise<void> | void): void {
		const current = { g: currentGeometry, k: currentKeymap };
		const pick = this.targets[orphanKey];
		const geometryIds = new Set(this.#deps.geometries().map((g) => g.id));
		const keymapIds = new Set(this.#deps.keymaps().map((k) => k.id));
		const target = pick && geometryIds.has(pick.g) && keymapIds.has(pick.k) ? pick : current;
		void this.remap(orphanKey, target.g, target.k, current, reload);
	}

	/** Drop picks for orphans that are gone, or that point at a board or keymap that no longer exists. */
	pruneTargets(live: Set<string>, geometryIds: Set<string>, keymapIds: Set<string>): void {
		for (const key of Object.keys(this.targets)) {
			const pick = this.targets[key];
			if (!live.has(key) || !geometryIds.has(pick.g) || !keymapIds.has(pick.k)) delete this.targets[key];
		}
	}

	/** Re-list the orphans. Never throws: a failure here is a note for the dialog, not a crash. */
	async refresh(): Promise<void> {
		try {
			const { stats, settings } = await this.#deps.loadKeys();
			const geometryIds = new Set(this.#deps.geometries().map((g) => g.id));
			const keymapIds = new Set(this.#deps.keymaps().map((k) => k.id));
			this.orphans = orphanKeys([...stats, ...settings], geometryIds, keymapIds);
			this.pruneTargets(new Set(this.orphans.map((o) => o.key)), geometryIds, keymapIds);
			this.error = undefined;
		} catch (err) {
			this.error = `orphan check failed: ${(err as Error).message}`;
		}
		this.#changed();
	}

	/** Fold one orphaned row into a surviving layout. In-flight guard: any fold in flight — this one or a
	 *  neighbour's — makes this call a no-op. Per the spec, the dialog disables the row set meanwhile, so
	 *  this path is only reachable by a stale control, never by a double-click. */
	async remap(orphanKey: string, geometryId: string, keymapId: string, current: { g: string; k: string }, reload: () => Promise<void> | void): Promise<void> {
		if (this.#folding.size > 0) return;
		this.#folding.add(orphanKey);
		this.#changed();
		try {
			await this.#deps.fold(orphanKey, geometryId, keymapId);
			if (layoutKey(geometryId, keymapId) === layoutKey(current.g, current.k)) void reload();
			await this.refresh();
		} catch (err) {
			this.error = `couldn't fold ${orphanKey}: ${(err as Error).message}`;
			this.#changed();
		} finally {
			this.#folding.delete(orphanKey);
			this.#changed();
		}
	}
}
