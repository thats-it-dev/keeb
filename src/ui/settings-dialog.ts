import { html, nothing } from "https://kit.thatsit.app/lit.js";
import { iconTrash, iconX } from "./icons.ts";
import type { Geometry, Keymap } from "../keyboard/types.ts";

export type SettingsProps = {
	/** The boards on screen: shipped and imported ones together, since either can be picked. */
	geometries: Geometry[];
	keymaps: Keymap[];
	geometryId: string;
	keymapId: string;
	/** The goal as the learner types it, in words per minute; storage keeps characters. */
	goalWpm: number;
	/** Minutes of practice today's bar aims for; 0 turns the bar off. Local to this device. */
	dailyGoalMin: number;
	/** Teach in keyboard order rather than by how often the language uses each letter. */
	keyboardOrder: boolean;
	/** Take words from the corpus instead of inventing them from the letter model. */
	realWords: boolean;
	did: string;
	handle: string;
	syncNote: string;
	boards: Geometry[];
	maps: Keymap[];
	problems: string[];
	onClose: (open: boolean) => void;
	onClick: (e: MouseEvent) => void;
	onPick: (part: "g" | "k", value: string) => void;
	onGoal: (e: Event) => void;
	onDailyGoal: (e: Event) => void;
	/** A curriculum switch: which letters come next, and where the words come from. */
	onCurriculum: (part: "keyboardOrder" | "realWords", on: boolean) => void;
	onUpload: (e: Event) => void;
	onHandle: (value: string) => void;
	onSignIn: () => void;
	onSignOut: () => void;
	onSync: () => void;
	onPublish: () => void;
	onRemoveBoard: (id: string) => void;
	onRemoveMap: (id: string) => void;
};

/**
 * The settings modal. Sign-in is one line of it, not a section: it is optional and rarely touched.
 *
 * Clicks on the ::backdrop land on the dialog element itself, not on its children, which is how the
 * dialog closes on a click outside — the caller owns that test, since it needs the element.
 */
export function settingsDialog(p: SettingsProps) {
	const boardRow = (b: { id: string; name: string }, label: string, onRemove: (id: string) => void) =>
		html`<div class="board"><span>${b.name}</span> <span class="label">${label}</span> <button class="x" aria-label=${`Remove ${b.name}`} @click=${() => onRemove(b.id)}>${iconTrash}</button></div>`;
	return html`
		<dialog @close=${() => p.onClose(false)} @click=${p.onClick} aria-label="Settings">
			<div class="modal-head">
				<span class="label">settings</span>
				<button class="x" aria-label="Close settings" @click=${() => p.onClose(false)}>${iconX}</button>
			</div>
			<div class="panel">
				<label><span class="label">keyboard</span><select @change=${(e: Event) => p.onPick("g", (e.target as HTMLSelectElement).value)}>
						${p.geometries.map((g) => html`<option value=${g.id} ?selected=${g.id === p.geometryId}>${g.name}</option>`)}
					</select></label>
				<label><span class="label">keymap</span><select @change=${(e: Event) => p.onPick("k", (e.target as HTMLSelectElement).value)}>
						${p.keymaps.map((k) => html`<option value=${k.id} ?selected=${k.id === p.keymapId}>${k.name}</option>`)}
					</select></label>
				<label><span class="label">goal wpm</span><input type="number" min="15" max="120" step="5" .value=${String(p.goalWpm)} @change=${p.onGoal} /></label>
				<label><span class="label">daily goal (min)</span><input type="number" min="5" max="240" step="5" .value=${String(p.dailyGoalMin)} @change=${p.onDailyGoal} /></label>
				<!-- The curriculum switches, in words a learner has. Both change what the next line contains,
				     so neither belongs in a place you discover by accident. -->
				<label class="full"><input type="checkbox" .checked=${p.keyboardOrder} @change=${(e: Event) => p.onCurriculum("keyboardOrder", (e.target as HTMLInputElement).checked)} /> <span class="label">teach in keyboard order</span></label>
				<label class="full"><input type="checkbox" .checked=${p.realWords} @change=${(e: Event) => p.onCurriculum("realWords", (e.target as HTMLInputElement).checked)} /> <span class="label">use real words</span></label>
				<label><span class="label">layout file</span><input type="file" accept=".json,application/json" @change=${p.onUpload} /></label>
				<div class="full sync">
					${p.did
						? html`<span class="label">${p.did}</span>
								<button class="btn ghost" @click=${p.onSync}>Sync now</button>
								<button class="btn ghost" @click=${p.onPublish}>Publish this layout</button>
								<button class="x" aria-label="Sign out" @click=${p.onSignOut}>${iconX}</button>`
						: html`<input
									aria-label="atproto handle"
									placeholder="you.bsky.social"
									.value=${p.handle}
									@input=${(e: Event) => p.onHandle((e.target as HTMLInputElement).value)}
								/>
								<button class="btn" @click=${p.onSignIn}>Sign in</button>`}
				</div>
				${p.syncNote ? html`<p class="full warn">${p.syncNote}</p>` : nothing}
				${p.boards.length ? html`<div class="full">${p.boards.map((b) => boardRow(b, `${b.keys.length} keys`, p.onRemoveBoard))}</div>` : nothing}
				${p.maps.length ? html`<div class="full">${p.maps.map((m) => boardRow(m, "characters", p.onRemoveMap))}</div>` : nothing}
				${p.problems.length ? html`<ul class="full problems">${p.problems.map((x) => html`<li>${x}</li>`)}</ul>` : nothing}
			</div>
		</dialog>
	`;
}

// showModal() and close() are imperative, so the reactive flag on the page drives them once per update.
export function syncDialog(root: DocumentFragment | HTMLElement, open: boolean): void {
	const dlg = root.querySelector("dialog") as HTMLDialogElement | null;
	if (!dlg || dlg.open === open) return;
	if (open) dlg.showModal();
	else dlg.close();
}
