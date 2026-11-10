import { saveSettings, saveStats, type Settings } from "../data/store.ts";
import { totals } from "../stats/stats.ts";
import type { StatMap } from "../stats/stats.ts";
import type { LessonEngine } from "../lesson/engine.ts";

/** The page as the recorder sees it. `read()` is called once per operation, so nothing is half-old. */
export type RecorderHost = {
	read(): { key: string; geometryId: string; keymapId: string; stats: StatMap; settings: Settings; targetCpm: number };
	writeStats(stats: StatMap): void;
	note(line: string): void;
	connected(): boolean;
	/** Practice ms of a finished session — keystroke time only — charged to today's tally on this device. */
	recordDay(ms: number): void;
	deliver(session: { chars: number; errors: number; ms: number; stats: StatMap }): Promise<{ sent?: number; error?: string }>;
};

/** A keystroke gap counts toward practice time up to this cap. Longer than this is a pause — reading
 *  the screen, hunting a finger position — and the part beyond the cap is never charged. */
const GAP_CAP_MS = 10_000;

/**
 * A session is the span between two silences, which is what the record is named for: it ends when the
 * learner walks away, and what they left behind becomes one row on their repo.
 *
 * The daily tally counts a different quantity from the record: keystroke time, gap by gap, capped. The
 * whole span from the first key to the closing silence includes every pause, and a bar that creeps
 * forward while nobody types teaches the learner to distrust it.
 */
export class SessionRecorder {
	// What the counters read when the current session started, so a session record holds a delta.
	#baseline = { chars: 0, errors: 0 };
	#startedAt = 0;
	// Completed keystroke gaps of the open session, and the instant of its last keystroke. A gap longer
	// than the cap is a pause, so the clock stops while the learner reads, and starts again at the key
	// they land next — the pause itself is never charged, not even the part under the cap.
	#typingMs = 0;
	#lastKeyAt = 0;
	#idleTimer: number | undefined;
	// The stats exactly as they were last written, so a keystroke that changed nothing writes nothing.
	#saved = "";

	constructor(readonly host: RecorderHost) {}

	/** A layout was just loaded or merged: its numbers are the new starting point. */
	seed(stats: StatMap): void {
		this.#saved = JSON.stringify(stats);
	}

	/** The first keystroke opens a span; every later one closes the gap before it onto the clock,
	 *  capped, so the tally is the time between keys and not the time since the first of them. */
	begin(): void {
		const t = Date.now();
		if (this.#startedAt) {
			this.#typingMs += Math.min(Math.max(0, t - this.#lastKeyAt), GAP_CAP_MS);
			this.#lastKeyAt = t;
			return;
		}
		this.#startedAt = t;
		this.#lastKeyAt = t;
		this.#typingMs = 0;
		this.#baseline = totals(this.host.read().stats);
	}

	/** Every keystroke re-arms the silence that closes the session. */
	arm(): void {
		if (this.#idleTimer !== undefined) window.clearTimeout(this.#idleTimer);
		this.#idleTimer = window.setTimeout(() => void this.end(), 120_000);
	}

	/** Write what the engine has learned. Reading the engine AFTER the keystroke is the whole point. */
	async stroke(engine: LessonEngine): Promise<void> {
		const { key, geometryId: g, keymapId: k, settings, targetCpm } = this.host.read();
		const stats = { ...engine.stats };
		this.host.writeStats(stats);
		const now = JSON.stringify(stats);
		if (now === this.#saved) return; // nothing moved: wrong key, or the line is already finished
		this.#saved = now;
		await saveStats(key, stats);
		// The layout ids are stored with the numbers so a reload finds the same board without asking anyone.
		// Not the unlocked letters: those are a verdict the ladder re-derives from `stats` on every line, and a
		// stored copy of it would be a second answer to the same question.
		await saveSettings(key, { ...settings, geometry: g, keymap: k, targetCpm });
	}

	/** Practice time so far: the closed gaps plus the gap since the last key, which stops growing once
	 *  it passes the cap. The daily bar reads this, so the clock runs with the fingers and stalls when
	 *  they stop. */
	elapsed(): number {
		return this.#startedAt ? this.#typingMs + Math.min(Math.max(0, Date.now() - this.#lastKeyAt), GAP_CAP_MS) : 0;
	}

	/** Close the session: the characters since it opened become one row on the repo, if there is an account. */
	async end(): Promise<void> {
		if (!this.#startedAt) return;
		if (this.#idleTimer !== undefined) window.clearTimeout(this.#idleTimer);
		this.#idleTimer = undefined;
		const statsNow = this.host.read().stats;
		const totalsNow = totals(statsNow);
		const chars = totalsNow.chars - this.#baseline.chars;
		const errors = totalsNow.errors - this.#baseline.errors;
		const t = Date.now();
		const ms = t - this.#startedAt;
		const typing = this.#typingMs + Math.min(Math.max(0, t - this.#lastKeyAt), GAP_CAP_MS);
		this.#startedAt = 0;
		this.#typingMs = 0;
		this.#lastKeyAt = 0;
		// The day is charged whether or not the session reaches a repo: time spent practising is time
		// spent, on a signed-out device just as on a synced one.
		if (chars > 0 && typing > 0) this.host.recordDay(typing);
		if (chars <= 0 || !this.host.connected()) return; // offline-first: the practice data is already in IndexedDB
		const res = await this.host.deliver({ chars, errors, ms, stats: this.host.read().stats });
		this.host.note(res.error ?? (res.sent ? `synced ${chars} characters` : ""));
	}
}
