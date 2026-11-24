import { describe, expect, it, vi } from "vitest";
import { signedInAccountControls } from "../src/ui/account-group.ts";

describe("the signed-in account group", () => {
	it("carries Sync now, Publish this layout and Sign out, in order", () => {
		const actions = { onSync: vi.fn(), onPublish: vi.fn(), onSignOut: vi.fn() };
		const controls = signedInAccountControls(actions);
		expect(controls.map((c) => c.label)).toEqual(["Sync now", "Publish this layout", "Sign out"]);
	});

	it("Sign out calls the sign-out handler, and nothing else", () => {
		const actions = { onSync: vi.fn(), onPublish: vi.fn(), onSignOut: vi.fn() };
		const signOut = signedInAccountControls(actions).find((c) => c.label === "Sign out")!;
		signOut.onClick();
		expect(actions.onSignOut).toHaveBeenCalledTimes(1);
		expect(actions.onSync).not.toHaveBeenCalled();
		expect(actions.onPublish).not.toHaveBeenCalled();
	});
});
