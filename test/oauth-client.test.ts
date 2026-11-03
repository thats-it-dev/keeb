// The OAuth client metadata is validated by the authorization server, not by us, and it is validated
// against rules this repo does not own (RFC 8252 in particular). So the test runs the library's own
// schema over both copies of the document rather than restating what it forbids.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { oauthClientMetadataSchema } from "@atproto/oauth-types";
import { CLIENT_ID, REDIRECT_URIS } from "../src/atproto/auth.ts";
import { SCOPES } from "../src/atproto/lexicons.ts";

const hosted = JSON.parse(readFileSync(new URL("../public/.well-known/oauth-client/client-metadata.json", import.meta.url), "utf8")) as Record<string, unknown>;

const check = (label: string, doc: Record<string, unknown>) => {
	const r = oauthClientMetadataSchema.safeParse(doc);
	// A zod issue list is unreadable in a failure message, so flatten it to "path: message".
	expect(r.success, `${label}: ${r.success ? "" : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ")}`).toBe(true);
};

describe("oauth client metadata", () => {
	it("is accepted by the library's own schema, hosted copy", () => {
		check("public/.well-known/oauth-client/client-metadata.json", hosted);
	});

	it("is accepted by the library's own schema, inline copy the client sends", () => {
		check("src/atproto/auth.ts", {
			client_id: CLIENT_ID,
			client_name: "TouchType",
			client_uri: "https://touchtype.thatsit.app",
			redirect_uris: REDIRECT_URIS,
			scope: SCOPES,
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
			application_type: "web",
			dpop_bound_access_tokens: true,
		});
	});

	it("agrees between the two copies, because the server compares them", () => {
		// The authorization server fetches the hosted document and rejects a client that describes itself
		// differently, so a change to one file has to land in the other in the same commit.
		expect(hosted.client_id).toBe(CLIENT_ID);
		expect(hosted.redirect_uris).toEqual(REDIRECT_URIS);
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
