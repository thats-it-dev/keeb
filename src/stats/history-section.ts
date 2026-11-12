import { html, nothing } from "https://kit.thatsit.app/lit.js";
import { cpmToWpm } from "./stats.ts";
import { history as buildHistory, series, type Point } from "./history.ts";
import { isPreviewHost, paneSessions } from "./demo.ts";
import type { SessionRow } from "../atproto/records.ts";

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
 * The practice history as a section of the insight panel.
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
	const lineSeries = [
		{ y: "wpm", label: "with pauses", defined: (q: Point) => q.sessions > 0 },
		{ y: "strokeWpm", label: "typing only", defined: (q: Point) => q.sessions > 0 && q.strokeWpm > 0 },
	];
	return html`
		<div class="hist">
			<h3>history · ${p.boardName}</h3>
			${p.demo
				? html`<p class="demo-note">
							<b>demo sessions</b> — nothing here is your progress, and none of it is stored or synced.
							<button class="link" @click=${() => p.onDemo(false)}>Use real data</button>
						</p>`
				: nothing}
			<tk-stats>
				<tk-stat label="sessions" .value=${h.sessions}></tk-stat>
				<tk-stat label="characters" .value=${h.chars}></tk-stat>
				<tk-stat label="practised" .value=${h.minutes} unit="min"></tk-stat>
				<tk-stat label="streak" .value=${h.streak} unit="d"></tk-stat>
				<tk-stat label="best day" .value=${h.best?.wpm ?? 0} unit="wpm"></tk-stat>
			</tk-stats>
			<tk-timeseries .data=${pts} x="day" .series=${lineSeries} band="wpm strokeWpm" band-label="pausing" .goal=${goal} unit="wpm"></tk-timeseries>
			<p class="empty">
				${h.activeDays} day${h.activeDays === 1 ? "" : "s"} practised${others > 0 ? `, plus ${others} session(s) on other boards` : ""}. The repo
				keeps the newest 50 sessions per layout, so these totals are that window rather than your whole life
				${h.undated ? `, and ${h.undated} session(s) had no readable date` : ""}.
			</p>
		</div>
	`;
}
