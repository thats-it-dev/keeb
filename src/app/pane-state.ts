import { PANEL_OPEN_KEY } from "../stats/panel-element.ts";
import { isPreviewHost } from "../stats/demo.ts";

/**
 * Which way the insight pane is folded on first paint. Three rules, in order of who wins:
 *
 *   - on a phone the pane is an off-canvas MENU, and a menu that redeploys itself over the page on every
 *     load is a bug users would report. The stored choice is ignored there; it always starts closed.
 *   - a branch preview defaults to OPEN, because the history section lives in the pane and on a preview
 *     that section carries the only "show demo sessions" prompt: a folded pane would leave a reviewer at
 *     a blank rail.
 *   - anywhere else, whatever the person last chose is what they get.
 */
export function panelStartsOpen(): boolean {
	if (!matchMedia("(min-width: 900px)").matches) return false;
	const stored = localStorage.getItem(PANEL_OPEN_KEY);
	return stored === null ? isPreviewHost(location.hostname, __APP_NAME__) : stored === "1";
}

export function rememberPanel(on: boolean): void {
	localStorage.setItem(PANEL_OPEN_KEY, on ? "1" : "0");
}

/** Fake history for previews, switched on by ?demo=1. */
export function demoFromUrl(): boolean {
	return new URLSearchParams(location.search).has("demo");
}

/**
 * Turning demo data on also puts it in the URL, so a preview link that shows a chart still shows one after a
 * reload or when forwarded onward. Turning it off removes the parameter and the rows with it: nothing is left
 * in storage, because nothing was ever written there.
 */
export function rememberDemoInUrl(on: boolean): void {
	// Query built through URLSearchParams, which cannot throw, rather than parsing location.href: the page
	// could be served from a path with characters a URL constructor would reject, and a settings toggle must
	// never be the thing that raises.
	const q = new URLSearchParams(location.search);
	if (on) q.set("demo", "");
	else q.delete("demo");
	const s = q.toString();
	history.replaceState(null, "", location.pathname + (s ? `?${s}` : "") + location.hash);
}
