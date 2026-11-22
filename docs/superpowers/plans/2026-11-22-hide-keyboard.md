# Hide the Keyboard Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a header icon button that hides and shows the keyboard board and its layer-hint line, remembered on this device.

**Architecture:** A localStorage-backed flag (device-wide, like `dailyGoalMin`) toggled by a `.x` header button in `app-main.ts`. The render conditionally renders `<tt-keyboard>` and `routeHint(...)`. Nothing on the keyboard/engine side changes.

**Tech Stack:** Lit + kit (`https://kit.thatsit.app/lit.js`), vitest for unit tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-11-22-hide-keyboard-design.md`

## Global Constraints

- Behaviour is local-only: localStorage, never the per-layout `Settings` row, never the atproto record.
- Default is visible; any unrecognised stored value answers visible.
- The toggle is a header button (`.x` + `slot="actions"`), NOT a dialog switch — the settings dialog keeps exactly 2 switches.
- Existing e2e selectors keep working: `tt-keyboard` renders by default.
- Icon is an inlined Lucide SVG in `src/ui/icons.ts` with the other icons.
- Comments: what the code does and why; no bug stories.
- Style: kit tokens only; no new `var(--…)`.
- Commits: `feat:`, imperative, ≤72 chars, optionally with a body.

## Review Focus

- Malformed `localStorage` value (e.g. `"banana"`) → visible (default), never a crash.
- Remembered hidden state on load → board absent from first paint; the practice pane and every other pane still work and keyboard input still reaches the practice pane (the flag must not touch `#onKey` or the practice component).
- Toggling hidden → visible → hidden again → board present each time the flag is true; the e2e toggles twice to prove no stuck state.
- The board's own e2e selectors (`tt-keyboard g[data-id="…"]`) keep working when the board is visible — the toggle must not subtly change the rendered board, only whether it renders.
- The settings dialog's switch count stays at 2 (`settings.spec.ts` asserts this).

---

### Task 1: device-local visibility store

**Files:**
- Create: `src/app/keyboard-visibility.ts`
- Create: `test/keyboard-visibility.test.ts`

**Interfaces:**
- Produces: `savedKeyboardVisible(): boolean` (default `true`; any value other than the string `"false"` answers `true`) and `setKeyboardVisible(visible: boolean): void`, both backed by localStorage key `keeb:keyboardVisible`.

- [ ] **Step 1: Write the failing test**

`test/keyboard-visibility.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { savedKeyboardVisible, setKeyboardVisible } from "../src/app/keyboard-visibility.ts";

function stubLocalStorage() {
	const map = new Map<string, string>();
	const stub: Storage = {
		getItem: (k) => (map.has(k) ? map.get(k)! : null),
		setItem: (k, v) => { map.set(k, String(v)); },
		removeItem: (k) => { map.delete(k); },
		clear: () => map.clear(),
		key: (i) => [...map.keys()][i] ?? null,
		get length() { return map.size; },
	} as Storage;
	(globalThis as any).localStorage = stub;
	return map;
}

describe("keyboard visibility store", () => {
	let map: Map<string, string>;
	beforeEach(() => { map = stubLocalStorage(); });

	it("answers true when nothing is stored", () => {
		expect(savedKeyboardVisible()).toBe(true);
	});
	it("answers true for any unrecognised stored value", () => {
		map.set("keeb:keyboardVisible", "banana");
		expect(savedKeyboardVisible()).toBe(true);
	});
	it("round-trips false and true", () => {
		setKeyboardVisible(false);
		expect(savedKeyboardVisible()).toBe(false);
		setKeyboardVisible(true);
		expect(savedKeyboardVisible()).toBe(true);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/keyboard-visibility.test.ts`
Expected: FAIL — cannot find module `src/app/keyboard-visibility.ts`.

- [ ] **Step 3: Implement `src/app/keyboard-visibility.ts`**

```ts
// The keyboard board shows or hides on one click; the choice is remembered on this device only,
// exactly like the daily-goal minutes (never per-layout, never on the wire).
const STORE = "keeb:keyboardVisible";

export function savedKeyboardVisible(): boolean {
	const raw = localStorage.getItem(STORE);
	if (raw === null) return true;
	return raw !== "false"; // any other value answers with the shipped default, never a crash
}

export function setKeyboardVisible(visible: boolean): void {
	localStorage.setItem(STORE, String(visible));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/keyboard-visibility.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/keyboard-visibility.ts test/keyboard-visibility.test.ts
git commit -m "feat: persist the keyboard visibility choice on the device"
```

### Task 2: header button + conditional render + spec + e2e

**Files:**
- Modify: `src/ui/icons.ts` (add `iconKeyboard`, inlined Lucide "keyboard", same `frame` helper, no `key` attributes)
- Modify: `src/app-main.ts` (new `keyboardVisible` reactive property; second actions-slot button; conditional `tt-keyboard` + `routeHint`)
- Modify: `docs/spec.md` (one bullet in §13 next to the daily-goal bullet)
- Create: `e2e/keyboard-toggle.spec.ts`

**Interfaces:**
- Consumes: `savedKeyboardVisible()`, `setKeyboardVisible(boolean)` from Task 1.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Write the failing e2e**

`e2e/keyboard-toggle.spec.ts`:

```ts
// The header keyboard button hides and shows the visualisation: the board and the layer hint line.
// The practice pane, the progress list and the readout are untouched by it. Local persistence is
// the contract; the switch itself is a header button, not a settings dialog switch.
import type { Page } from "@playwright/test";
import { expect, test } from "./csp.ts";

const button = (page: Page) => page.getByRole("button", { name: /keyboard/i }).last();
const board = (page: Page) => page.locator("tt-keyboard");

test("hides and shows the keyboard, and the choice survives a reload", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator("tt-practice .line")).toBeVisible();
	await expect(board(page)).toBeVisible();

	await button(page).click();
	await expect(board(page)).toHaveCount(0);

	await page.reload();
	await expect(board(page)).toHaveCount(0); // remembered

	await button(page).click();
	await expect(board(page)).toBeVisible(); // back

	await page.reload();
	await expect(board(page)).toBeVisible(); // visible again after a reload
});
```

Note: the button's accessible name is "Hide keyboard" / "Show keyboard"; `.last()` is defensive
against a settings-dialog label of the same name (there is none, today). The test must not use
`page.waitForTimeout`.

- [ ] **Step 2: Run the e2e to verify it fails**

Run: `npx playwright test e2e/keyboard-toggle.spec.ts --project=chromium`
Expected: FAIL — the toggle button does not exist (`getByRole` finds no toggle).

- [ ] **Step 3: Add the icon and the state + render changes**

`src/ui/icons.ts`: add `export const iconKeyboard = frame(svg\`…\`);` with the Lucide keyboard paths (rect 2,4 / 20×16 rx=2, plus the 8 h.01 dots and the 7,16h10 space bar, no `key` attributes) — copied from the icon, not invented.

`src/app-main.ts`:
- import `savedKeyboardVisible, setKeyboardVisible` and `iconKeyboard`.
- Add `keyboardVisible: boolean` to `static properties` and back it with a field:
  `keyboardVisible = savedKeyboardVisible();`
  (placed next to the other reactive fields; no constructor work — localStorage is synchronous and
  safe in the constructor.)
- Add a private handler `#toggleKeyboard(): void { this.keyboardVisible = !this.keyboardVisible; setKeyboardVisible(this.keyboardVisible); }`.
- In the header, before the settings gear button (both `slot="actions"`, keyboard first):

  ```html
  <button slot="actions" class="x" aria-pressed=${String(!this.keyboardVisible)}
    aria-label=${this.keyboardVisible ? "Hide keyboard" : "Show keyboard"}
    @click=${() => this.#toggleKeyboard()}>${iconKeyboard}</button>
  ```
- In the render: wrap the board and hint in a conditional. Replace the two bare lines
  `<tt-keyboard …></tt-keyboard>` and `${routeHint(r, this.routeChar)}` with:

  ```ts
  ${this.keyboardVisible
    ? html`<tt-keyboard .resolved=${r} .active=${this.lastId} .focusId=${o?.focusId ?? ""} .route=${routeOf(r, this.routeChar)}></tt-keyboard>
    ${routeHint(r, this.routeChar)}`
    : nothing}
  ```

- [ ] **Step 4: Run the e2e to verify it passes**

Run: `npx playwright test e2e/keyboard-toggle.spec.ts --project=chromium`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full verification**

Run: `npm run verify`
Expected: typecheck + unit tests + lint + full e2e all green.

- [ ] **Step 6: Write the spec bullet**

`docs/spec.md` §13 — after the daily-goal bullet, add a sibling bullet:

- The keyboard visibility lives in a browser-wide localStorage slot (`keeb:keyboardVisible`),
  never on the wire; it hides the board and its layer hint together.

- [ ] **Step 7: Commit**

```bash
git add src/ui/icons.ts src/app-main.ts docs/spec.md e2e/keyboard-toggle.spec.ts
git commit -m "feat: hide the keyboard visualization from a header button"
```

### Task 3: branch + PR

**Files:** none (git operations)

- [ ] `git switch -c hide-keyboard` from `main` (the current branch is a merged-PR branch that pi-guard has already moved to `main`).
- [ ] `npm run verify` green.
- [ ] Run the thatsit-app `pr` command (never `git push` or `gh pr merge`). Report PR link + preview link; stop — Michael merges.
