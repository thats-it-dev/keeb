import { expect, test as base } from "@playwright/test";

// Fails any test that sees a CSP violation. The recorder is installed before load so startup violations count too.
export const test = base.extend({
	page: async ({ page }, use) => {
		await page.addInitScript(() => {
			// SAFETY: the recorder lives on window before any app code runs; nothing else writes this key.
			const w = window as unknown as { __csp: string[] };
			w.__csp = [];
			// Each test starts from the app defaults. Without this, a test that opened a collapsible panel
			// leaves it open for every later test in the same worker -- the insights panel is 300px of the
			// 1280px viewport, and the content next to it moves what the pointer lands on.
			// Only the UI key is cleared: "keeb:layout" is a board the visitor picked by hand, which the reload
			// tests exist to prove survives, and the OAuth keys must persist across a redirect.
			//
			// The guard matters as much as the clear. An init script runs before EVERY navigation, including a
			// reload inside a test, so clearing unconditionally would erase the very state a test sets out to
			// verify survives. First load of a context means "fresh browser", which is what is being reset.
			if (!sessionStorage.getItem("keeb-test-loaded")) {
				sessionStorage.setItem("keeb-test-loaded", "1");
				localStorage.removeItem("keeb:panels");
			}
			document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
		});
		await use(page);
		// SAFETY: read back after the page ran; __csp is optional here because navigation may have replaced it.
		const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
		expect(violations).toEqual([]);
	},
});
export { expect };
