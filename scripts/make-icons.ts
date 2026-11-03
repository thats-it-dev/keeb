// PWA and favicon icons, written without a graphics dependency — the same way pi-web does it
// (app/scripts/make-icons.mjs): a PNG encoder in ~30 lines, then coverage per pixel.
//
// What changed from that is only the glyph. Instead of a dot it draws Lucide's `keyboard` icon, taken
// from the installed lucide package rather than retyped, in the app colour from app.config.json.
// Strokes are rasterised analytically: a path becomes a set of capsules, a rect becomes a rounded-rect
// ring, and a pixel's coverage is how far inside the stroke it sits. That is exact for these shapes and
// needs no font, canvas or native binding.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { loadConfig } from "../vite/config.ts";
import Keyboard, { type IconNode } from "lucide/dist/esm/icons/keyboard.mjs";

const { color } = loadConfig();
const BG = [0x17, 0x17, 0x17];
const INK = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
const VIEW = 24; // lucide draws on a 24x24 grid
const STROKE = 2; // lucide's default stroke-width

type Point = [number, number];
// Everything the rasteriser understands: a capsule (a zero-length one is a round dot) and a stroked
// rounded rectangle. Lucide's keyboard needs nothing else.
type Shape = { kind: "capsule"; a: Point; b: Point } | { kind: "ring"; x: number; y: number; w: number; h: number; r: number };

// A subset of the SVG path language: M/L/H/V and their relative forms, with implicit lineto after a
// moveto. That is all lucide emits for this icon; anything else is refused rather than drawn wrong.
function parsePath(d: string): Point[][] {
	const out: Point[][] = [];
	const tokens = d.match(/[MmLlHhVvZz]|[-+.\d]+(?:e[-+]?\d+)?/gi) ?? [];
	let i = 0;
	let cmd = "";
	let cur: Point = [0, 0];
	const take = (): number => {
		const v = Number(tokens[i++]);
		if (!Number.isFinite(v)) throw new Error(`path token is not a number in "${d}"`);
		return v;
	};
	while (i < tokens.length) {
		if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
		if (cmd === "z" || cmd === "Z") break;
		const abs = cmd === cmd.toUpperCase();
		const at = (v: number, axis: 0 | 1) => (abs ? v : cur[axis] + v); // only the axis the command moves
		let next: Point;
		switch (cmd.toUpperCase()) {
			case "H":
				next = [at(take(), 0), cur[1]];
				break;
			case "V":
				next = [cur[0], at(take(), 1)];
				break;
			default:
				next = [at(take(), 0), at(take(), 1)];
				break;
		}
		// A moveto starts a subpath, and a lone moveto with round caps is a dot — which is exactly what
		// lucide's key markers are. Its repeated coordinates are absolute linetos in the same case.
		if (cmd.toUpperCase() === "M") {
			out.push([[...next] as Point]);
			cmd = abs ? "L" : "l";
		} else out.push([[...cur] as Point, [...next] as Point]);
		cur = next;
	}
	return out;
}

function shapes(): Shape[] {
	const list: Shape[] = [];
	for (const [tag, attrs] of Keyboard as IconNode) {
		if (tag === "rect") {
			// lucide spells these "width" and "height"; reading attrs.w gives NaN, which silently draws
			// nothing for the outline of the board. Compare with the svg writer below, which uses the same keys.
			list.push({ kind: "ring", x: +attrs.x, y: +attrs.y, w: +attrs.width, h: +attrs.height, r: +(attrs.rx ?? 0) });
			continue;
		}
		if (tag !== "path") throw new Error(`make-icons: lucide node "${tag}" is not something this script can draw`);
		for (const sub of parsePath(attrs.d)) list.push({ kind: "capsule", a: sub[0], b: sub[sub.length - 1] });
	}
	return list;
}

const CRC = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (buf: Uint8Array) => {
	let c = 0xffffffff;
	for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

const distCapsule = (px: number, py: number, a: Point, b: Point, half: number) => {
	const vx = b[0] - a[0];
	const vy = b[1] - a[1];
	const len2 = vx * vx + vy * vy;
	const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - a[0]) * vx + (py - a[1]) * vy) / len2));
	return Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy)) - half;
};

// Distance to the outline of a rounded rect, so a stroke of half-width `half` is |sd| - half.
const distRing = (px: number, py: number, s: Extract<Shape, { kind: "ring" }>, half: number) => {
	const inner: Point = [Math.max(s.w / 2 - s.r, 0.001), Math.max(s.h / 2 - s.r, 0.001)];
	const cx = s.x + s.w / 2;
	const cy = s.y + s.h / 2;
	const qx = Math.abs(px - cx) - inner[0];
	const qy = Math.abs(py - cy) - inner[1];
	const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - s.r;
	return Math.abs(sd) - half;
};

/**
 * `fit` is how much of the tile the glyph may use. A plain icon fills the square; a maskable one has to
 * survive being clipped to a circle by the platform, so it draws smaller and centred.
 */
function png(size: number, fit: number) {
	const scale = (size * fit) / VIEW; // pixels per viewBox unit
	const dx = (size - VIEW * scale) / 2;
	const dy = (size - VIEW * scale) / 2;
	const half = STROKE / 2; // in viewBox units, like every other distance in here
	const list = shapes();
	const stride = size * 3 + 1;
	const raw = Buffer.alloc(stride * size);
	for (let y = 0; y < size; y++) {
		raw[y * stride] = 0; // filter: none
		for (let x = 0; x < size; x++) {
			// pixel → viewBox: undo the centring offset, then divide by the scale. Adding dx here put the
			// whole glyph off the canvas and produced a flat background, which is why two different fits
			// hashed to the same bytes.
			const px = (x + 0.5 - dx) / scale;
			const py = (y + 0.5 - dy) / scale;
			let d = Infinity;
			for (const s of list) {
				const e = s.kind === "ring" ? distRing(px, py, s, half) : distCapsule(px, py, s.a, s.b, half);
				if (e < d) d = e;
			}
			// The ramp is one pixel wide, so the distance is converted to pixels here and nowhere else.
			const a = Math.min(1, Math.max(0, 0.5 - d * scale));
			const o = y * stride + 1 + x * 3;
			for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - a) + INK[i] * a);
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // RGB
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// The SVG companion, in the same shapes the rasteriser understands, so the two cannot disagree about
// what the icon looks like.
function svgIcon(): string {
	const body = (Keyboard as IconNode)
		.map(([tag, a]) => (tag === "rect" ? `<rect x="${a.x}" y="${a.y}" width="${a.width}" height="${a.height}" rx="${a.rx ?? 0}"/>` : `<path d="${a.d}"/>`))
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}"><rect width="${VIEW}" height="${VIEW}" rx="5" fill="#171717"/><g fill="none" stroke="${color}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 0)">${body}</g></svg>\n`;
}

const out = new URL("../public/icons/", import.meta.url);
mkdirSync(out, { recursive: true });
for (const [name, size, fit] of [
	["icon-192.png", 192, 0.82],
	["icon-512.png", 512, 0.82],
	["icon-maskable-512.png", 512, 0.62], // inside the circle a launcher may clip to
	["apple-touch-icon.png", 180, 0.82],
	// iOS also probes these at the site root; without them a static host answers
	// with the HTML shell and the Home Screen gets a letter instead of the icon.
	["../apple-touch-icon.png", 180, 0.82],
	["../apple-touch-icon-precomposed.png", 180, 0.82],
] as [string, number, number][]) {
	writeFileSync(new URL(name, out), png(size, fit));
}
writeFileSync(new URL("icon.svg", out), svgIcon());
console.log(`icons written to public/icons (lucide keyboard in ${color})`);
