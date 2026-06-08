"use client";

import { useCallback, useMemo, useState } from "react";
import type { SDArtifactsResponse } from "@/app/types";
import { DeployUnitCommandCard } from "@/components/sd-artifacts-scan-results/DeployUnitCommandCard";
import { Button } from "@/components/ui/button";
import { workloadProductLabel, type WorkloadClassification } from "@/lib/sdArtifactsWorkload";
import {
	applyRailpackCommandOverrides,
	extractRailpackCommands,
	railpackCommandOverridesDirty,
} from "@/lib/railpackCommandOverrides";
import { draftsFromResults, type UnitCommandDrafts } from "@/lib/scanResultsCommandDrafts";
import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

type BuildConfigurationSectionProps = {
	results: SDArtifactsResponse;
	workload: WorkloadClassification | null;
	buildOk: boolean;
	onUpdateResults?: (results: SDArtifactsResponse) => Promise<void> | void;
};

export function BuildConfigurationSection({
	results,
	workload,
	buildOk,
	onUpdateResults,
}: BuildConfigurationSectionProps) {
	const baseline = useMemo(() => draftsFromResults(results), [results]);
	const [draftOverrides, setDraftOverrides] = useState<UnitCommandDrafts | null>(null);
	const [saving, setSaving] = useState(false);
	const [prevResultsId, setPrevResultsId] = useState(results.response_id);

	if (results.response_id !== prevResultsId) {
		setPrevResultsId(results.response_id);
		setDraftOverrides(null);
	}

	const drafts = draftOverrides ?? baseline;

	const anyDirty = useMemo(
		() =>
			draftOverrides !== null &&
			results.deploy_units.some((unit) => {
				const draft = drafts[unit.name];
				const base = baseline[unit.name];
				if (!draft || !base) return false;
				return railpackCommandOverridesDirty(base, draft);
			}),
		[baseline, draftOverrides, drafts, results.deploy_units],
	);

	const updateUnitDraft = useCallback(
		(unitName: string, next: UnitCommandDrafts[string]) => {
			setDraftOverrides((prev) => ({ ...(prev ?? baseline), [unitName]: next }));
		},
		[baseline],
	);

	const handleResetCommands = useCallback(() => {
		setDraftOverrides(null);
		toast.message("Build commands reset");
	}, []);

	const handleSaveCommands = useCallback(async () => {
		if (!onUpdateResults || !anyDirty) return;

		const nextResults: SDArtifactsResponse = {
			...results,
			deploy_units: results.deploy_units.map((unit) => {
				const draft = drafts[unit.name];
				const plan = unit.artifacts.railpack_plan;
				if (!draft || !plan) return unit;

				return {
					...unit,
					artifacts: {
						...unit.artifacts,
						railpack_plan: applyRailpackCommandOverrides(plan, draft),
					},
				};
			}),
		};

		setSaving(true);
		try {
			await onUpdateResults(nextResults);
			setDraftOverrides(null);
			toast.success("Build commands saved");
		} catch (err) {
			console.error("Failed to save build commands:", err);
			toast.error(err instanceof Error ? err.message : "Failed to save build commands");
		} finally {
			setSaving(false);
		}
	}, [anyDirty, drafts, onUpdateResults, results]);

	return (
		<>
			{anyDirty && buildOk ? (
				<div className="mb-6 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-950 dark:text-amber-100">
					<p>
						Build commands were changed locally. Save before deploying — sd-artifacts verification may no longer
						match the edited plan.
					</p>
				</div>
			) : null}

			<div className="mb-6 rounded-xl border border-border bg-card p-5">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Build configuration</p>
						<p className="mt-1 text-sm text-muted-foreground">
							Edit install, build, and start commands applied to the Railpack plan at deploy time.
						</p>
					</div>
					{onUpdateResults ? (
						<div className="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="gap-2"
								disabled={!anyDirty || saving}
								onClick={handleResetCommands}
							>
								<RotateCcw className="size-3.5" />
								Reset
							</Button>
							<Button
								type="button"
								size="sm"
								className="gap-2"
								disabled={!anyDirty || saving}
								onClick={() => void handleSaveCommands()}
							>
								<Save className="size-3.5" />
								{saving ? "Saving…" : "Save commands"}
							</Button>
						</div>
					) : null}
				</div>
				<ul className="space-y-4">
					{results.deploy_units.map((unit) => {
						const draft = drafts[unit.name] ?? extractRailpackCommands(unit.artifacts.railpack_plan);
						const base = baseline[unit.name] ?? draft;
						const workloadUnit = workload?.units.find((u) => u.name === unit.name);
						return (
							<DeployUnitCommandCard
								key={unit.name}
								unit={unit}
								draft={draft}
								baseline={base}
								workloadLabel={workloadUnit ? workloadProductLabel(workloadUnit.product) : unit.type}
								disabled={!onUpdateResults || saving}
								onChange={(next) => updateUnitDraft(unit.name, next)}
							/>
						);
					})}
				</ul>
			</div>
		</>
	);
}
