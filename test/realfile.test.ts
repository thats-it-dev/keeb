// Michael's actual keymap, when it is sitting in his workspace: the fixture is a redaction of it, but the
// claims below are about THAT file, so a divergence between the two shows up here first. CI has no such
// file, so the whole block skips there.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GO60 } from "../src/data/go60.ts";
import { keymapFromKeycap, type KeycapFile } from "../src/layout/keycap.ts";
import { resolve } from "../src/keyboard/resolve.ts";
import { layoutFromRecord, layoutRecord, boardFromLayout } from "../src/atproto/records.ts";

const REAL = `${process.env.HOME}/workspace/keymaps/go60-36.json`;

describe.skipIf(!existsSync(REAL))("the real go60-36.json", () => {
	const file = JSON.parse(readFileSync(REAL, "utf8")) as KeycapFile;
	const { keymap } = keymapFromKeycap(file, GO60);
	const r = resolve(GO60, keymap!);

	it("never routes a character through a control chord", () => {
		expect(r.routeChars.get("q")!.layer).toBe(0); // LG(Q) on the Fn layer quits apps; it is not the Q key
		expect(r.routeChars.get("4")!.layer).toBeLessThan(3); // "4" rides the number row or NavNum's tap, never the LC(LG(LS(N4))) shortcut
		for (const route of r.routes) expect(route.layer === 3, `layer-3 route ${route.char} on ${route.keyId}`).toBe(false); // Fn types nothing at all now
	});

	it("teaches the shifted symbols, and both spellings of the quote", () => {
		for (const ch of ["(", ")", "&", "$", "%", "\""]) expect(r.routeChars.get(ch), `route for ${ch}`).toBeTruthy();
		expect(r.routeChars.get("\"")!.layer).toBe(1); // LS(SINGLE_QUOTE) on the Sym layer
	});

	it("names the thumbs as the file does, on the board and after a round trip", () => {
		expect(r.byId.get("R_T2")!.char).toBe("Enter");
		expect(r.byId.get("L_T3")!.char).toBe("Tab");
		const chars = r.keys.map((k) => ({ id: k.id, char: k.char }));
		const rec = layoutRecord("Go60", "go60-36.json", GO60, chars, { layerNames: r.layerNames, layerKeys: keymap!.layerKeys });
		const back = layoutFromRecord(rec as unknown as Record<string, unknown>)!;
		expect(back.byKey["R_T2"]).toBe("Enter"); // "Ente" was the truncation bug
		const { keymap: roundKeymap } = boardFromLayout("rk", back);
		expect(resolve(GO60, roundKeymap).byId.get("R_T2")!.char).toBe("Enter");
	});
});
