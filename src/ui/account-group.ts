/**
 * The buttons a signed-in account group carries, in order — the visible text and the click handler both
 * live here so a test can pin the set without mounting the dialog: a control that silently disappears
 * and one that silently gets renamed both look like a working account row.
 */
export function signedInAccountControls(actions: {
	onSync: () => void;
	onPublish: () => void;
	onSignOut: () => void;
}): { label: string; onClick: () => void }[] {
	return [
		{ label: "Sync now", onClick: actions.onSync },
		{ label: "Publish this layout", onClick: actions.onPublish },
		{ label: "Sign out", onClick: actions.onSignOut },
	];
}
