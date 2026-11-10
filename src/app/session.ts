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
	deliver(session: { chars: number; errors: number; ms: number; stats: StatMap }): Promise<{ sent?: number; error?: string }>;
};

/**
 * A session is the span between two silences, which is what the record is named for: it ends when the
 * learner walks away, and what they left behind becomes one row on their repo.
 */
export class SessionRecorder {
	// What the counters read when the current session started, so a session record holds a delta.
	#baseline = { chars: 0, errors: 0 };
	#startedAt = 0;
	#idleTimer: number | undefined;
	// The stats exactly as they were last written, so a keystroke that changed nothing writes nothing.
	#saved = "";

	constructor(readonly host: RecorderHost) {}

	/** A layout was just loaded or merged: its numbers are the new starting point. */
	seed(stats: StatMap): void {
		this.#saved = JSON.stringify(stats);
	}

	/** The first keystroke of a span opens it. */
	begin(): void {
		if (this.#startedAt) return;
		this.#startedAt = Date.now();
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

	/** Close the session: the characters since it opened become one row on the repo, if there is an account. */
	async end(): Promise<void> {
		if (!this.#startedAt) return;
		if (this.#idleTimer !== undefined) window.clearTimeout(this.#idleTimer);
		this.#idleTimer = undefined;
		const now = totals(this.host.read().stats);
		const chars = now.chars - this.#baseline.chars;
		const errors = now.errors - this.#baseline.errors;
		const ms = Date.now() - this.#startedAt;
		this.#startedAt = 0;
		if (chars <= 0 || !this.host.connected()) return; // offline-first: the practice data is already in IndexedDB
		const res = await this.host.deliver({ chars, errors, ms, stats: this.host.read().stats });
		this.host.note(res.error ?? (res.sent ? `synced ${chars} characters` : ""));
	}
}
