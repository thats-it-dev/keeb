// Sign in with an atproto account. The app works without this: sync is an add-on, never a gate.
//
// The flow is the browser redirect flow — send the learner to their PDS, come back to this page with a
// code in the query string, and exchange it. Everything the client has to keep (the DPoP key, the
// tokens, the pending auth request) lives in IndexedDB inside the library, so there is no secret in
// localStorage and nothing is lost by closing the tab.
// Type-only: the runtime import is deferred, so a signed-out learner never downloads the OAuth client.
import type { BrowserOAuthClient, OAuthSession } from "@atproto/oauth-client-browser";
import { SCOPES } from "./lexicons.ts";

// The authorization server fetches the hosted copy of the metadata and compares it with what we send,
// so public/.well-known/oauth-client/client-metadata.json has to agree with the object below.
export const CLIENT_ID = "https://touchtype.thatsit.app/.well-known/oauth-client/client-metadata.json";

// Every origin this app can be signed in from. A preview deploy is a different origin, so a branch that
// wants to test the real flow adds its own URL here and to the hosted file.
export const REDIRECT_URIS: [string, ...string[]] = ["https://touchtype.thatsit.app/", "https://m4-atproto.touchtype.pages.dev/", "http://localhost:5173/"];

const METADATA = {
	client_id: CLIENT_ID,
	client_name: "TouchType",
	client_uri: "https://touchtype.thatsit.app",
	redirect_uris: REDIRECT_URIS,
	scope: SCOPES,
	grant_types: ["authorization_code", "refresh_token"] as ["authorization_code", "refresh_token"],
	response_types: ["code"] as ["code"],
	token_endpoint_auth_method: "none" as const,
	application_type: "web" as const,
	dpop_bound_access_tokens: true,
};

// CLIENT_ID is a literal, so a failure here would be a bug in this file rather than bad input.
const originOf = (u: string): string => {
	try {
		return new URL(u).origin;
	} catch {
		return "";
	}
};

/** This app's own origin: the one place a sign-in must never send the learner back to. */
const SELF_ORIGIN = originOf(CLIENT_ID);

/** Where the library's own storage keeps nothing we care about; this is the pointer we keep. */
const DID_KEY = "touchtype:atproto:did";

/** The part of a session this app depends on — one method, which is what makes sync.ts testable. */
export type Session = {
	did: string;
	fetchHandler(pathname: string, init?: RequestInit): Promise<Response>;
};

const asSession = (s: OAuthSession): Session => ({ did: s.did, fetchHandler: (p, init) => s.fetchHandler(p, init) });

let clientPromise: Promise<BrowserOAuthClient> | undefined;

export class Auth {
	// Built on first use, and as a separate chunk: constructing it touches IndexedDB, and most page loads
	// never sign anyone in. The dynamic import keeps ~60 kB of CBOR and DPoP code off the offline path.
	async #client(): Promise<BrowserOAuthClient> {
		if (!clientPromise) {
			clientPromise = import("@atproto/oauth-client-browser").then(({ BrowserOAuthClient }) =>
				new BrowserOAuthClient({
					clientMetadata: METADATA,
					responseMode: "query",
					// Handles resolve through Bluesky's public AppView: a read-only lookup, and the only third
					// party this app contacts beyond the learner's own PDS.
					handleResolver: "https://public.api.bsky.app",
				}),
			);
		}
		return clientPromise;
	}

	/**
	 * Whoever this browser says is signed in. Finishes a redirect that is still in flight, then falls
	 * back to restoring the stored account. Undefined means not signed in, which is the normal case.
	 */
	async session(): Promise<Session | undefined> {
		const params = this.#params();
		if (params?.has("code") && params.has("state")) {
			const client = await this.#client();
			const { session } = await client.callback(params);
			localStorage.setItem(DID_KEY, session.did);
			// The code is single-use: leaving it in the address bar means a refresh throws an oauth error.
			history.replaceState(null, "", location.pathname + location.hash);
			return asSession(session);
		}
		const did = localStorage.getItem(DID_KEY);
		if (!did) return undefined; // nothing stored: the OAuth chunk is never fetched
		try {
			const client = await this.#client();
			return asSession(await client.restore(did));
		} catch {
			// A session the PDS no longer recognises. Forget it so the UI stops offering to sync.
			localStorage.removeItem(DID_KEY);
			return undefined;
		}
	}

	/**
	 * Where to send the learner to approve this app. The caller navigates: keeping the jump outside this
	 * module is what lets a test assert the destination, and the destination is checked here, where the
	 * value is made. It may be the learner's PDS over https and nowhere near this page's own origin.
	 */
	async authorizeUrl(handleOrDid: string): Promise<string> {
		const input = handleOrDid.trim().replace(/^@/, "");
		if (!input) throw new Error("enter your handle or DID first");
		const client = await this.#client();
		const url = await client.authorize(input);
		if (url.protocol !== "https:" || !url.hostname || url.origin === SELF_ORIGIN) {
			throw new Error(`refusing to leave this page for ${url.origin || "an invalid address"}`);
		}
		return url.toString();
	}

	async signOut(): Promise<void> {
		const did = localStorage.getItem(DID_KEY);
		if (!did) return;
		const client = await this.#client();
		try {
			await client.revoke(did);
		} catch {
			/* an unreachable PDS must not strand someone in a signed-in state */
		}
		localStorage.removeItem(DID_KEY);
	}

	#params(): URLSearchParams | undefined {
		try {
			return new URL(location.href).searchParams;
		} catch {
			return undefined;
		}
	}
}

export const auth = new Auth();
