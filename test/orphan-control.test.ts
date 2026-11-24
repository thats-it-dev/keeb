// The orphan control: detection, picks and fold serialization, driven with injected side effects.
import { describe, expect, it } from "vitest";
import { OrphanControl, type OrphanControlDeps } from "../src/app/orphan-control.ts";

const LIVE = {
	geometries: () => [{ id: "go60" }, { id: "import:surviving" }],
	keymaps: () => [{ id: "qwerty" }, { id: "import:surviving-keys" }],
};

function deps(overrides: Partial<OrphanControlDeps> = {}): OrphanControlDeps & { foldCalls: string[][] } {
	const foldCalls: string[][] = [];
	return {
		loadKeys: async () => ({ stats: [], settings: [] }),
		geometries: LIVE.geometries,
		keymaps: LIVE.keymaps,
		fold: async (orphanKey, geometryId, keymapId) => { foldCalls.push([orphanKey, geometryId, keymapId]); },
		...overrides,
		foldCalls,
	};
}

const current = { g: "go60", k: "qwerty" };

describe("OrphanControl", () => {
	it("a fold already running makes the next fold an ignored no-op", async () => {
		let release: () => void;
		const fold = new Promise<void>((r) => { release = r; });
		let foldCalls = 0;
		const d = deps({ fold: async () => { foldCalls++; await fold; } });
		const control = new OrphanControl(() => {}, d);

		const first = control.remap("import:deleted-board+qwerty", "go60", "qwerty", current, () => {});
		// A second fold, for a different orphan, while the first is in flight: ignored.
		await control.remap("import:deleted-board+import:deleted-keys", "go60", "qwerty", current, () => {});
		expect(foldCalls).toBe(1);

		release!();
		await first;
		expect(foldCalls).toBe(1);
		expect(control.error).toBeUndefined();
	});

	it("a stale pick falls back to the current selection, never a dead target", () => {
		const d = deps();
		const control = new OrphanControl(() => {}, d);
		control.targets["import:deleted-board+qwerty"] = { g: "import:deleted-board", k: "qwerty" };

		control.remapFor("import:deleted-board+qwerty", "go60", "qwerty", () => {});

		expect(d.foldCalls).toEqual([["import:deleted-board+qwerty", "go60", "qwerty"]]);
	});

	it("picks pointing at live targets survive the refresh", async () => {
		const d = deps({
			loadKeys: async () => ({ stats: ["import:deleted-board+qwerty"], settings: [] }),
		});
		const control = new OrphanControl(() => {}, d);
		control.targets["import:deleted-board+qwerty"] = { g: "import:surviving", k: "import:surviving-keys" };

		await control.refresh();
		expect(control.targets["import:deleted-board+qwerty"]).toEqual({ g: "import:surviving", k: "import:surviving-keys" });
	});

	it("picks pointing at dead orphans or dead targets are pruned", async () => {
		const d = deps({
			loadKeys: async () => ({ stats: ["import:deleted-board+qwerty"], settings: [] }),
		});
		const control = new OrphanControl(() => {}, d);
		control.targets["import:deleted-board+qwerty"] = { g: "import:deleted-board", k: "qwerty" };
		control.targets["go60+qwerty"] = { g: "go60", k: "qwerty" };

		await control.refresh();

		expect(control.targets["import:deleted-board+qwerty"]).toBeUndefined();
		expect(control.targets["go60+qwerty"]).toBeUndefined();
	});

	it("unions stats and settings keys and dedupes them", async () => {
		const d = deps({
			loadKeys: async () => ({
				stats: ["import:deleted-board+qwerty", "go60+qwerty"],
				settings: ["import:deleted-board+qwerty", "import:deleted-board+import:deleted-keys"],
			}),
		});
		const control = new OrphanControl(() => {}, d);

		await control.refresh();

		expect(control.orphans.map((o) => o.key).sort()).toEqual([
			"import:deleted-board+import:deleted-keys",
			"import:deleted-board+qwerty",
		]);
	});

	it("busy is true while a fold is in flight and false after it finishes", async () => {
		let release: () => void;
		const d = deps({ fold: async () => new Promise<void>((r) => { release = r; }) });
		const control = new OrphanControl(() => {}, d);

		const pending = control.remap("import:deleted-board+qwerty", "go60", "qwerty", current, () => {});
		expect(control.anyFolding).toBe(true);

		release!();
		await pending;
		expect(control.anyFolding).toBe(false);
	});

	it("a failed fold keeps the row, the pick, says so in the dialog, and clears busy", async () => {
		// The fold consumes the orphan before throwing, so a refresh inside the catch would re-read a
		// different list — which is what makes the row assertion below prove the catch refreshes nothing.
		let orphans = ["import:deleted-board+qwerty"];
		const d = deps({
			loadKeys: async () => ({ stats: [...orphans], settings: [] }),
			fold: async () => { orphans = []; throw new Error("merge exploded"); },
		});
		const control = new OrphanControl(() => {}, d);
		await control.refresh();
		expect(control.orphans.map((o) => o.key)).toEqual(["import:deleted-board+qwerty"]);
		control.targets["import:deleted-board+qwerty"] = { g: "go60", k: "qwerty" };

		await control.remap("import:deleted-board+qwerty", "go60", "qwerty", current, () => {});

		expect(control.error).toContain("merge exploded");
		// The row and the pick survive: the fold failed, so nothing may be re-pointed or dropped.
		expect(control.orphans.map((o) => o.key)).toEqual(["import:deleted-board+qwerty"]);
		expect(control.targets["import:deleted-board+qwerty"]).toEqual({ g: "go60", k: "qwerty" });
		expect(control.anyFolding).toBe(false);
	});
});
