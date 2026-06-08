import type { SDArtifactsResponse } from "@/app/types";
import { extractRailpackCommands, type RailpackCommandOverrides } from "@/lib/railpackCommandOverrides";

export type UnitCommandDrafts = Record<string, RailpackCommandOverrides>;

export function draftsFromResults(results: SDArtifactsResponse): UnitCommandDrafts {
	const drafts: UnitCommandDrafts = {};
	for (const unit of results.deploy_units) {
		drafts[unit.name] = extractRailpackCommands(unit.artifacts.railpack_plan);
	}
	return drafts;
}
