import { describe, expect, it } from "vitest";
import { pickRoutes, type Candidate } from "../src/keyboard/routes.ts";

// A candidate is one (char, key, layer) the map says you could type. The route is the one the lesson
// will teach: taught rows first, then the shortest reach from home, then the file's own layer order.
const c = (over: Partial<Candidate>): Candidate => ({ char: "x", keyId: "K", layer: 0, taught: true, distanceToHome: 100, matrixIndex: 0, ...over });

describe("picking a route per character", () => {
	it("prefers a taught key over the number row however far it sits", () => {
		const routes = pickRoutes([c({ char: "7", keyId: "N_ROW", layer: 0, taught: false, distanceToHome: Infinity }), c({ char: "7", keyId: "HOME_ISH", layer: 2, distanceToHome: 400 })]);
		expect(routes).toEqual([{ char: "7", keyId: "HOME_ISH", layer: 2, statId: "HOME_ISH.2" }]);
	});

	it("prefers the occurrence closest to the home row", () => {
		const routes = pickRoutes([c({ char: "1", keyId: "UPPER", layer: 1, distanceToHome: 224 }), c({ char: "1", keyId: "LOWER", layer: 2, distanceToHome: 141 })]);
		expect(routes[0].keyId).toBe("LOWER");
	});

	it("breaks a distance tie by lower layer, then matrix position, then key id", () => {
		const tied = pickRoutes([c({ char: "7", keyId: "B", layer: 2 }), c({ char: "7", keyId: "A", layer: 1 })]);
		expect(tied[0].keyId).toBe("A"); // layer wins over id
		const sameLayer = pickRoutes([c({ char: "3", keyId: "Z", layer: 1, matrixIndex: 9 }), c({ char: "3", keyId: "Y", layer: 1, matrixIndex: 4 })]);
		expect(sameLayer[0].keyId).toBe("Y"); // matrix position
		const lastResort = pickRoutes([c({ char: "4", keyId: "b" }), c({ char: "4", keyId: "a" })]);
		expect(lastResort[0].keyId).toBe("a"); // and it never depends on the order they arrived in
	});

	it("leaves a base-layer route with the bare key id", () => {
		const routes = pickRoutes([c({ char: "e", keyId: "L_C3R2", layer: 0 })]);
		expect(routes[0].statId).toBe("L_C3R2");
	});

	it("is deterministic and sorted over a shuffled crowd", () => {
		const many: Candidate[] = [];
		for (const ch of ["a", "b", "c"]) for (let layer = 0; layer < 4; layer += 1) for (let pos = 0; pos < 3; pos += 1) many.push(c({ char: ch, keyId: `K${ch}${layer}${pos}`, layer, matrixIndex: pos, distanceToHome: layer * 10 + pos }));
		const shuffled = [...many].reverse();
		expect(pickRoutes(shuffled)).toEqual(pickRoutes(many));
		expect(pickRoutes(many).map((r) => r.char)).toEqual(["a", "b", "c"]);
	});
});
