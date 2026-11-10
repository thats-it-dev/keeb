import { html, svg, nothing } from "https://kit.thatsit.app/lit.js";
import { scaleBand, scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import { max } from "d3-array";
import { cpmToWpm } from "./stats.ts";
import { history as buildHistory, series, type Point } from "./history.ts";
import { isPreviewHost, paneSessions } from "./demo.ts";
import { card } from "../ui/card.ts";
import type { SessionRow } from "../atproto/records.ts";

// The history chart's geometry, in SVG units: room on the left for speed labels, below for dates.
const CH = { w: 340, h: 118, pad: { l: 26, r: 8, t: 10, b: 24 } };

/** "YYYY-MM-DD" back to a local date at noon, so no timezone edge can move it into yesterday. */
function parseDay(day: string): Date {
	const [y, m, d] = day.split("-").map(Number);
	return new Date(y!, (m ?? 1) - 1, d ?? 1, 12);
}

export type HistoryProps = {
	/** The board on screen; history is per layout, so this is both a filter and the section heading. */
	boardName: string;
	/** `layoutKey(geometryId, keymapId)` — rows for any other layout are counted out of the totals. */
	key: string;
	/** Show generated sessions instead of the synced ones. */
	demo: boolean;
	sessions: SessionRow[];
	targetCpm: number;
	onDemo: (on: boolean) => void;
};

/**
 * The practice history as a section of the insight panel. Its markup comes from here, not from a child
 * element: the SVG is built from d3 scales, and a template handed to a child would be styled by the child's
 * stylesheet, which knows nothing about `.chart` or `.trend`.
 *
 * Speed on a Go60 says nothing about the same fingers on a Corne, so the rows are filtered by layout exactly
 * like the key bars beside them. The character count here is the honest one the key screen could not show:
 * it adds up what each session recorded, where per-key `samples` is a weighted mean and sums to nothing
 * meaningful.
 */
export function historySection(p: HistoryProps) {
	const mine = paneSessions(p.demo, p.key, p.sessions);
	// Only the real history can hold another board; the invented rows are all for the layout on screen.
	const others = p.demo ? 0 : p.sessions.length - mine.length;
	if (!mine.length) {
		// A preview deploy is the same artifact as production, so the hostname is the only way to know this
		// is a branch preview -- and on one, an empty chart tells a reviewer nothing. The data stays opt-in:
		// generated per render, labelled, never written to storage or to a repo.
		if (p.sessions.length || !isPreviewHost(location.hostname, __APP_NAME__)) return nothing;
		return html`
			<div class="hist">
				<h3>history · ${p.boardName}</h3>
				<p class="demo-note">
					<b>preview</b> No synced sessions yet.
					<button class="link" @click=${() => p.onDemo(true)}>Show demo sessions</button>
				</p>
			</div>
		`;
	}
	const h = buildHistory(mine);
	const pts = series(h, 40);
	const goal = cpmToWpm(p.targetCpm);
	// d3 for the maths, Lit for the DOM. d3-selection would create and patch these nodes itself, and two
	// owners of one subtree is how a chart ends up rendering state the component has already dropped.
	// scaleBand over the day KEYS, so a skipped day still consumes a slot and the gap is real position.
	const x = scaleBand<string>().domain(pts.map((q) => q.day)).range([CH.pad.l, CH.w - CH.pad.r]).padding(0.3);
	// .nice() after the domain is set -- scaleLinear([0, n]) would read that array as the RANGE.
	const y = scaleLinear()
		.domain([0, Math.max(goal * 1.2, max(pts, (q) => Math.max(q.wpm, q.strokeWpm)) ?? 0, 10)])
		.range([CH.h - CH.pad.b, CH.pad.t])
		.nice();
	const every = Math.max(1, Math.ceil(pts.length / 5)); // about five date labels at any span
	const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
	const mid = (day: string) => (x(day) ?? 0) + x.bandwidth() / 2;
	const data = pts.filter((q) => q.sessions > 0);
	// .defined() is the whole trick of drawing a line honestly over a practice history: a day with no
	// sessions breaks the path instead of letting it slope down through a day you were not at the
	// keyboard. Rest days stay visible as the gap between two segments.
	const trend = line<Point>()
		.defined((q) => q.sessions > 0)
		.x((q) => mid(q.day))
		.y((q) => y(q.wpm));
	// A day whose sessions carry no per-key stats has no stroke measurement at all. It must draw the clock
	// line and nothing else: treating strokeWpm 0 as "zero typing time" would shade the entire band under
	// the curve as pausing, which is the opposite of what is known about that day.
	const stroked = (q: Point) => q.sessions > 0 && q.strokeWpm > 0;
	const typing = line<Point>()
		.defined(stroked)
		.x((q) => mid(q.day))
		.y((q) => y(q.strokeWpm));
	// The band between the two lines IS the hesitation: same characters, the gap is the time they did not
	// take. Filled rather than left as white space, because the emptiness is the finding.
	const gap = area<Point>()
		.defined(stroked)
		.x((q) => mid(q.day))
		.y0((q) => y(q.wpm))
		.y1((q) => y(q.strokeWpm));
	return html`
		<div class="hist">
			<h3>history · ${p.boardName}</h3>
			${p.demo
				? html`<p class="demo-note">
							<b>demo sessions</b> — nothing here is your progress, and none of it is stored or synced.
							<button class="link" @click=${() => p.onDemo(false)}>Use real data</button>
						</p>`
				: nothing}
			<div class="grid">
				${card("sessions", `${h.sessions}`)} ${card("characters", `${h.chars}`)} ${card("practised", `${h.minutes} min`)} ${card("streak", `${h.streak} d`)}
				${card("best day", `${h.best?.wpm ?? 0} wpm`)}
			</div>
			<svg
				viewBox="0 0 ${CH.w} ${CH.h}"
				class="chart"
				role="img"
				aria-label=${`${h.activeDays} days practised. Typing speed ${h.strokeWpm} wpm, with pauses ${h.wpm} wpm. Best day ${h.best?.wpm ?? 0} wpm, goal ${goal} wpm.`}
			>
				${y
					.ticks(4)
					.filter((v) => v > 0)
					.map(
						(v) => svg`<g class="grid"><line x1=${CH.pad.l} x2=${CH.w - CH.pad.r} y1=${y(v)} y2=${y(v)} /><text x=${CH.pad.l - 5} y=${y(v)} dy="0.32em" text-anchor="end">${v}</text></g>`,
					)}
				<line class="axis" x1=${CH.pad.l} x2=${CH.w - CH.pad.r} y1=${y(0)} y2=${y(0)} />
				<path class="gap" d=${gap(pts) ?? ""} />
				<line class="goal" x1=${CH.pad.l} x2=${CH.w - CH.pad.r} y1=${y(goal)} y2=${y(goal)} />
				<path class="typing" d=${typing(pts) ?? ""} />
				<path class="trend" d=${trend(pts) ?? ""} />
				${data.map((q) => svg`<circle data-day=${q.day} cx=${mid(q.day)} cy=${y(q.wpm)} r="2.4" class=${q.wpm >= goal ? "ok" : "under"}><title>${`${q.day}: ${q.wpm} wpm with pauses, ${q.strokeWpm} wpm typing only, over ${q.minutes} min, ${q.sessions} session(s)`}</title></circle>`)}
				${pts
					.filter((_, i) => i % every === 0)
					.map((q) => svg`<text class="tick" x=${mid(q.day)} y=${CH.h - CH.pad.b + 11} text-anchor="middle">${fmt.format(parseDay(q.day))}</text>`)}
				<text class="goal-label" x=${CH.w - CH.pad.r} y=${y(goal)} dy="-3" text-anchor="end">goal ${goal}</text>
			</svg>
			<p class="legend">
				<span class="key typing"></span>typing only
				<span class="gapkey"></span>time spent not typing
				<span class="key clock"></span>what the clock said
			</p>
			<p class="empty">
				${h.activeDays} day${h.activeDays === 1 ? "" : "s"} practised${others > 0 ? `, plus ${others} session(s) on other boards` : ""}. The repo
				keeps the newest 50 sessions per layout, so these totals are that window rather than your whole life
				${h.undated ? `, and ${h.undated} session(s) had no readable date` : ""}.
			</p>
		</div>
	`;
}
