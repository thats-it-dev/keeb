// Orphaned progress: stats and settings rows whose layout was deleted. The layout row is gone, so the
// numbers can no longer be read — this is the one repair path that folds them into a surviving layout.
// Local only: the PDS records and sync bookkeeping are deliberately untouched.
import { mergeAll, type StatMap } from "../stats/stats.ts";
import { layoutKey, type Settings } from "../data/store.ts";

export type OrphanRef = { key: string; geometryId: string; keymapId: string };

/** `import:slug+qwerty` → the two ids. Ids never contain a `+` (slugs collapse non-alphanumerics), so
 *  the last `+` is the separator. Anything that isn't two non-empty parts is not a layout key. */
export function parseLayoutKey(key: string): { geometryId: string; keymapId: string } | undefined {
	const at = key.lastIndexOf("+");
	if (at < 1) return undefined;
	const geometryId = key.slice(0, at);
	const keymapId = key.slice(at + 1);
	if (!geometryId || !keymapId) return undefined;
	return { geometryId, keymapId };
}

/**
 * Every key whose geometry or keymap no longer exists. Shipped and imported boards must both resolve;
 * the caller passes the id sets, keeping this pure and testable. A key can arrive once per store, so
 * the input is de-duplicated.
 */
export function orphanKeys(keys: string[], geometryIds: ReadonlySet<string>, keymapIds: ReadonlySet<string>): OrphanRef[] {
	const out: OrphanRef[] = [];
	for (const key of new Set(keys)) {
		const parsed = parseLayoutKey(key);
		if (!parsed) continue;
		if (geometryIds.has(parsed.geometryId) && keymapIds.has(parsed.keymapId)) continue;
		out.push({ key, ...parsed });
	}
	return out;
}

export type OrphanFoldDeps = {
	loadStats(key: string): Promise<StatMap>;
	loadSettingsRaw(key: string): Promise<Settings | undefined>;
	/** The atomic write: merge the orphan's numbers into the target, carry the settings row if the caller
	 *  says it should be carried, drop the orphan's rows — in one transaction. */
	mergeAndDelete(targetKey: string, orphanKey: string, mergedStats: StatMap, carriedSettings: Settings | undefined): Promise<void>;
};

type RemapResult = {
	/** The target key the orphan's numbers were folded into. */
	targetKey: string;
	/** Whether the target already had numbers of its own. The fold is lossless either way. */
	targetHadProgress: boolean;
	/** Whether the orphan's settings row was carried over. False when the target already has its own row —
	 *  that row is live data and the orphan's must not overwrite it. */
	settingsCarried: boolean;
};

/**
 * Fold one orphaned row into a surviving layout. Both sides survive the merge, so the target's own
 * numbers and the orphan's are both kept. The orphan's settings row is carried over only when the
 * target has no settings row of its own — and rewritten to name the target, so it cannot claim to be
 * the deleted board's.
 */
export async function remapOrphan(orphanKey: string, targetGeometry: string, targetKeymap: string, deps: OrphanFoldDeps): Promise<RemapResult> {
	const targetKey = layoutKey(targetGeometry, targetKeymap);
	if (orphanKey === targetKey) return { targetKey, targetHadProgress: false, settingsCarried: false };
	const [orphanStats, targetStats, orphanSettings, targetSettings] = await Promise.all([deps.loadStats(orphanKey), deps.loadStats(targetKey), deps.loadSettingsRaw(orphanKey), deps.loadSettingsRaw(targetKey)]);
	const merged = mergeAll(targetStats, orphanStats);
	const at = targetKey.lastIndexOf("+");
	const carried = orphanSettings && !targetSettings ? { ...orphanSettings, geometry: targetKey.slice(0, at), keymap: targetKey.slice(at + 1) } : undefined;
	await deps.mergeAndDelete(targetKey, orphanKey, merged, carried);
	return { targetKey, targetHadProgress: Object.keys(targetStats).length > 0, settingsCarried: Boolean(carried) };
}
