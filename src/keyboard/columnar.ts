import { U, type KeyTuple } from "./geometry.ts";
import type { RowRole } from "./types.ts";

// A row of a symmetric columnar board, indexed by column from the outside edge (0 = far pinky).
export type ColumnarRow = { role: RowRole; left: readonly string[]; right: readonly string[] };

export type ThumbKey = { col: number; x: number; y: number; rot?: number; label: string; h?: number };

export type ColumnarOpts = {
	// Vertical offset per column, in 1/100 key units. Columnar stagger lives here.
	colOffset: number[];
	leftInnerX: number; // x of the left hand's innermost (index) column
	rightInnerX: number; // x of the right hand's innermost column
	rows: ColumnarRow[];
	thumbs: { l: ThumbKey[]; r: ThumbKey[] };
};

function rowY(rows: ColumnarRow[], i: number, col: number, colOffset: number[]): number {
	let base = 0;
	for (let r = 0; r < i; r += 1) if (rows[r].role !== "thumb") base += 100;
	return base + (colOffset[col] ?? 0);
}

export function columnarKeys(o: ColumnarOpts): KeyTuple[] {
	const out: KeyTuple[] = [];
	o.rows.forEach((row, i) => {
		if (row.role === "thumb") return;
		for (let col = 0; col < row.left.length; col += 1) {
			// Column 0 is the outer edge of each hand, so the left hand counts rightward from its inner column.
			out.push([`L${i}-${col}`, "l", i, col, o.leftInnerX - (row.left.length - 1 - col) * 100, rowY(o.rows, i, col, o.colOffset), row.left[col] ?? ""]);
		}
		for (let col = 0; col < row.right.length; col += 1) {
			out.push([`R${i}-${col}`, "r", i, col, o.rightInnerX + (row.right.length - 1 - col) * 100, rowY(o.rows, i, col, o.colOffset), row.right[col] ?? ""]);
		}
	});
	for (const t of o.thumbs.l) out.push([`LT${t.col}`, "l", o.rows.length, t.col, Math.round(t.x * 100), Math.round(t.y * 100), t.label, t.rot ?? 0, U, Math.round((t.h ?? 1) * 100)]);
	for (const t of o.thumbs.r) out.push([`RT${t.col}`, "r", o.rows.length, t.col, Math.round(t.x * 100), Math.round(t.y * 100), t.label, -(t.rot ?? 0), U, Math.round((t.h ?? 1) * 100)]);
	return out;
}
