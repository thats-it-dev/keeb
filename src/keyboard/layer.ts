import type { Resolved } from "./resolve.ts";

/** Choose the displayed character for a key at a given layer index.
 *  If the requested layer has a non-empty string at that position, return it;
 *  otherwise fall back to the key's base character. */
export function charForLayer(resolved: Resolved, keyIndex: number, layer: number): string {
	const layers = resolved.layers;
	if (layers?.[layer]) {
		const c = layers[layer][keyIndex];
		if (c !== "") return c;
	}
	return resolved.keys[keyIndex].char;
}
