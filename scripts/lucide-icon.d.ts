// lucide ships no types on its per-icon deep paths (and has no "exports" map to attach them to), but the
// data itself is plain and stable: an array of [tag, attributes]. Declared here so make-icons.ts can
// import the real geometry instead of a transcription of it.
declare module "lucide/dist/esm/icons/keyboard.mjs" {
	/** e.g. ["path", { d: "M10 8h.01" }] or ["rect", { x: "2", y: "4", width: "20", height: "16", rx: "2" }] */
	export type IconNode = [tag: string, attrs: Record<string, string>][];
	const icon: IconNode;
	export default icon;
}
