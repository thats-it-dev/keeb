// The OAuth client metadata is validated by the authorization server, not by us, and it is validated
// against rules this repo does not own (RFC 8252 in particular). So the test runs the library's own
// schema over both copies of the document rather than restating what it forbids.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { oauthClientMetadataSchema } from "@atproto/oauth-types";
import { CLIENT_ID, CLIENT_METADATA } from "../src/atproto/auth.ts";
import { SCOPES } from "../src/atproto/lexicons.ts";
import { loadConfig } from "../vite/config.ts";

const cfg = loadConfig();

const hosted = JSON.parse(readFileSync(new URL("../public/.well-known/oauth-client/client-metadata.json", import.meta.url), "utf8")) as Record<string, unknown>;

const check = (label: string, doc: unknown) => {
	const r = oauthClientMetadataSchema.safeParse(doc);
	// A zod issue list is unreadable in a failure message, so flatten it to "path: message".
	expect(r.success, `${label}: ${r.success ? "" : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ")}`).toBe(true);
};

describe("oauth client metadata", () => {
	it("is accepted by the library's own schema, hosted copy", () => {
		check("public/.well-known/oauth-client/client-metadata.json", hosted);
	});

	it("is accepted by the library's own schema, inline copy the client sends", () => {
		// The object the client actually constructs with, not a re-typed copy of it.
		check("src/atproto/auth.ts", CLIENT_METADATA);
	});

	it("agrees between the two copies, because the server compares them", () => {
		// The authorization server fetches the hosted document and rejects a client that describes itself
		// differently, so a change to one file has to land in the other in the same commit.
		for (const field of ["client_id", "client_name", "client_uri", "redirect_uris", "scope", "grant_types", "response_types", "token_endpoint_auth_method", "application_type", "dpop_bound_access_tokens"]) {
			expect(hosted[field], field).toEqual((CLIENT_METADATA as Record<string, unknown>)[field]);
		}
		// The client id has to live on the deployed origin, which is the app name under thatsit.app.
		expect(new URL(CLIENT_ID).hostname).toBe(`${cfg.name}.thatsit.app`);
		// The name shown on the PDS consent screen is the app's own title, from the one place it is set.
		expect(hosted.client_name).toBe(cfg.title);
		expect(String(hosted.scope).split(/\s+/).sort()).toEqual(SCOPES.split(/\s+/).sort());
	});

	it("names the collections it asks permission for", () => {
		// A scope that omits a collection means writes to it fail at the PDS, not here.
		for (const nsid of ["settings", "progress", "session", "layout"]) expect(SCOPES).toContain(`repo:app.thatsit.typing.${nsid}`);
	});

	it("would catch the localhost dev redirect that the library rejects", () => {
		// Regression guard for the exact error a dev hits on first sign-in.
		const bad = { ...hosted, redirect_uris: ["http://localhost:5173/"] };
		const r = oauthClientMetadataSchema.safeParse(bad);
		expect(r.success).toBe(false);
	});
});
