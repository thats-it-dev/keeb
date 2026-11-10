import { defineConfig, devices } from "@playwright/test";

// BASE_URL points the suite at a deployed site (CSP then comes from Cloudflare); otherwise it builds and previews locally.
const base = process.env.BASE_URL;

export default defineConfig({
	testDir: "e2e",
	timeout: 60_000,
	expect: { timeout: 15_000 },
	// Tests share only the preview server, so they run in parallel.
	workers: process.env.CI ? 2 : "50%",
	use: { baseURL: base || "http://localhost:4317", trace: "retain-on-failure" },
	projects: [
		// No hasTouch: Chromium with a coarse pointer swallows synthetic keyboard events, so a
		// keystroke test that passes on desktop times out here. Phone covers layout and paint.
		{ name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
		{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
	],
	webServer: base ? undefined : { command: "npm run build && npx vite preview --port 4317 --strictPort", port: 4317, reuseExistingServer: false, timeout: 120_000 },
});
