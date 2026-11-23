import { svg } from "https://kit.thatsit.app/lit.js";

// Icons from Lucide v1.67.0 (ISC, https://lucide.dev), inlined rather than depended on: the app's
// CSP keeps the bundle self-contained, and svg markup inside a shadow root must be built with lit's
// `svg` tag — `html` puts the nodes in the HTML namespace and they paint nothing.
const frame = (paths: ReturnType<typeof svg>) => svg`
	<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
		stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
		aria-hidden="true" style="display:block">${paths}`;

export const iconSettings = frame(svg`
	<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
	<circle cx="12" cy="12" r="3" />
`);

export const iconX = frame(svg`
	<path d="M18 6 6 18" />
	<path d="m6 6 12 12" />
`);

export const iconEye = frame(svg`
	<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
	<circle cx="12" cy="12" r="3" />
`);

export const iconEyeClosed = frame(svg`
	<path d="m15 18l-.722-3.25M2 8a10.645 10.645 0 0 0 20 0m-2 7l-1.726-2.05M4 15l1.726-2.05M9 18l.722-3.25" />
`);

export const iconTrash = frame(svg`	<path d="M10 11v6" />
	<path d="M14 11v6" />
	<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
	<path d="M3 6h18" />
	<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
`);

