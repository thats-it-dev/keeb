// The orphan repair: stats rows whose layout was deleted are folded into a surviving layout.
import { describe, expect, it } from "vitest";
import { orphanKeys, parseLayoutKey, remapOrphan, type OrphanFoldDeps } from "../src/app/repair.ts";
import { DEFAULT_SETTINGS, layoutKey, type Settings } from "../src/data/store.ts";
import type { KeyStat, StatMap } from "../src/stats/stats.ts";

const geometryIds = new Set(["go60", "import:surviving-go60"]);
const keymapIds = new Set(["qwerty", "import:surviving-keys"]);

function statsOf(samples: number, errors = 0): StatMap {
	const s: KeyStat = { ttMs16: 1600, samples, errors };
	return { a: { ...s } };
}

function fakeDeps(initial: { stats: Record<string, StatMap>; settings: Record<string, Settings | undefined> }) {
	const stats = new Map(Object.entries(initial.stats));
	const settings = new Map(Object.entries(initial.settings));
	const deps: OrphanFoldDeps = {
		loadStats: async (key) => stats.get(key) ?? {},
		loadSettingsRaw: async (key) => settings.get(key),
		// The atomic write: merge the orphan into the target, carry the settings row when the caller says
		// it should be carried, drop the orphan's rows — one transaction.
		mergeAndDelete: async (targetKey, orphanKey, merged, carried) => {
			if (Object.keys(merged).length) stats.set(targetKey, merged);
			stats.delete(orphanKey);
			settings.delete(orphanKey);
			if (carried) settings.set(targetKey, carried);
		},
	};
	return { deps, stats, settings };
}

describe("parseLayoutKey", () => {
	it("splits on the last +, so an id with a + never mis-cuts", () => {
		expect(parseLayoutKey("go60+qwerty")).toEqual({ geometryId: "go60", keymapId: "qwerty" });
		expect(parseLayoutKey("import:surviving-go60+import:surviving-keys")).toEqual({ geometryId: "import:surviving-go60", keymapId: "import:surviving-keys" });
	});

	it("rejects a key with no separator or an empty side", () => {
		expect(parseLayoutKey("go60")).toBeUndefined();
		expect(parseLayoutKey("+qwerty")).toBeUndefined();
		expect(parseLayoutKey("go60+")).toBeUndefined();
	});
});

describe("orphanKeys", () => {
	it("keeps only keys whose geometry and keymap both exist", () => {
		const keys = ["go60+qwerty", "import:deleted-board+qwerty", "go60+import:deleted-map", "go60+qwerty"];
		const orphans = orphanKeys(keys, geometryIds, keymapIds);
		expect(orphans).toEqual([
			{ key: "import:deleted-board+qwerty", geometryId: "import:deleted-board", keymapId: "qwerty" },
			{ key: "go60+import:deleted-map", geometryId: "go60", keymapId: "import:deleted-map" },
		]);
	});

	it("skips malformed keys rather than inventing ids", () => {
		expect(orphanKeys(["garbage"], geometryIds, keymapIds)).toEqual([]);
	});
});

describe("remapOrphan", () => {
	it("folds the orphan's stats into the target and deletes the orphan rows", async () => {
		const orphan = "import:deleted-board+qwerty";
		const target = layoutKey("go60", "qwerty");
		const { deps, stats, settings } = fakeDeps({
			stats: { [orphan]: statsOf(40, 1), [target]: statsOf(42, 1) },
			settings: { [orphan]: { ...DEFAULT_SETTINGS, targetCpm: 240 }, [target]: undefined },
		});

		const result = await remapOrphan(orphan, "go60", "qwerty", deps);

		expect(stats.get(orphan)).toBeUndefined();
		expect(settings.get(orphan)).toBeUndefined();
		// Both sides keep their strokes: the target's 42 live on, the orphan's 40 fold in.
		expect(stats.get(target)?.["a"].samples).toBe(40 + 42);
		expect(stats.get(target)?.["a"].errors).toBe(2);
		expect(result.targetKey).toBe(target);
		expect(result.settingsCarried).toBe(true);
		// The carried row must name the target, not the deleted board.
		expect(settings.get(target)?.geometry).toBe("go60");
		expect(settings.get(target)?.targetCpm).toBe(240);
	});

	it("does not overwrite a target's own settings row", async () => {
		const orphan = "import:deleted-board+qwerty";
		const target = layoutKey("go60", "qwerty");
		const own = { ...DEFAULT_SETTINGS, targetCpm: 200, geometry: "go60", keymap: "qwerty" };
		const { deps, settings } = fakeDeps({
			stats: { [orphan]: statsOf(10), [target]: statsOf(5) },
			settings: { [orphan]: { ...DEFAULT_SETTINGS, targetCpm: 240 }, [target]: own },
		});

		const result = await remapOrphan(orphan, "go60", "qwerty", deps);

		expect(result.settingsCarried).toBe(false);
		expect(settings.get(target)).toEqual(own);
		expect(settings.has(orphan)).toBe(false);
	});

	it("merges the orphan's stats in as a plain add when the target has none", async () => {
		const orphan = "import:deleted-board+qwerty";
		const target = layoutKey("import:surviving-go60", "import:surviving-keys");
		const { deps, stats } = fakeDeps({ stats: { [orphan]: statsOf(25) }, settings: {} });

		await remapOrphan(orphan, "import:surviving-go60", "import:surviving-keys", deps);

		expect(stats.get(target)?.["a"].samples).toBe(25);
	});

	it("a settings-only orphan folds without inventing an empty stats row", async () => {
		const orphan = "import:deleted-board+qwerty";
		const target = layoutKey("go60", "qwerty");
		const { deps, stats, settings } = fakeDeps({
			stats: {},
			settings: { [orphan]: { ...DEFAULT_SETTINGS, targetCpm: 240 }, [target]: undefined },
		});

		const result = await remapOrphan(orphan, "go60", "qwerty", deps);

		expect(result.settingsCarried).toBe(true);
		expect(stats.has(target)).toBe(false);
		expect(settings.get(orphan)).toBeUndefined();
		expect(settings.get(target)?.targetCpm).toBe(240);
	});

	it("is a no-op when the orphan is the target itself", async () => {
		const orphan = "import:deleted-board+qwerty";
		const { deps, stats, settings } = fakeDeps({ stats: { [orphan]: statsOf(10) }, settings: { [orphan]: DEFAULT_SETTINGS } });

		const result = await remapOrphan(orphan, "import:deleted-board", "qwerty", deps);

		expect(result.settingsCarried).toBe(false);
		expect(stats.get(orphan)?.["a"].samples).toBe(10);
		expect(settings.get(orphan)).toBeDefined();
	});
});
