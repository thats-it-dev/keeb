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
