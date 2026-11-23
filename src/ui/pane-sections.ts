import { historySection } from "../stats/history-section.ts";
import { insightPanel, type PanelCard } from "../stats/panel.ts";
import { paneSessions } from "../stats/demo.ts";
import { describeRoute } from "../stats/format.ts";
import { layoutKey } from "../data/store.ts";
import { geometryById } from "../data/geometries.ts";
import type { SessionRow } from "../atproto/records.ts";
import type { Resolved } from "../keyboard/resolve.ts";

/** How the page reads the history section: which board, which layout, generated or real, the
 *  target speed, and the callback the demo button makes when it is asked to generate. */
export type PaneSectionProps = {
	geometryId: string;
	keymapId: string;
	demo: boolean;
	sessions: SessionRow[];
	targetCpm: number;
	onDemo: (on: boolean) => void;
};

export function historyPane(p: PaneSectionProps): ReturnType<typeof historySection> {
	return historySection({
		boardName: geometryById(p.geometryId).name,
		key: layoutKey(p.geometryId, p.keymapId),
		demo: p.demo,
		sessions: p.sessions,
		targetCpm: p.targetCpm,
		onDemo: p.onDemo,
	});
}

/**
 * The cards live with the pane, not with the section they describe, so both have to pick the same rows
 * the chart draws -- demo or real, this layout only.
 */
export function paneCards(p: Omit<PaneSectionProps, "onDemo"> & { resolved: Resolved }): PanelCard[] {
	return insightPanel(paneSessions(p.demo, layoutKey(p.geometryId, p.keymapId), p.sessions), p.targetCpm, (id) => describeRoute(id, (s) => p.resolved.routes.find((x) => x.statId === s)?.char ?? s, (l) => p.resolved.layerNames[l] ?? ""));
}

