"use client";

import { useReducer } from "react";
import type { DeployConfig, SDArtifactsResponse } from "@/app/types";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ImproveScanDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	results: SDArtifactsResponse;
	deployment: DeployConfig;
	packagePath?: string;
	onStartImproveScan?: (payload: {
		repoUrl: string;
		commitSha?: string;
		packagePath?: string;
		feedback: string;
		failedArtifactScope?: string;
	}) => void;
};

type ImproveDialogState = {
	feedback: string;
};

type ImproveDialogAction =
	| { type: "reset" }
	| { type: "set_feedback"; value: string };

function improveDialogReducer(state: ImproveDialogState, action: ImproveDialogAction): ImproveDialogState {
	switch (action.type) {
		case "reset":
			return { feedback: "" };
		case "set_feedback":
			return { ...state, feedback: action.value };
		default:
			return state;
	}
}

export function ImproveScanDialog({
	open,
	onOpenChange,
	results,
	deployment,
	packagePath,
	onStartImproveScan,
}: ImproveScanDialogProps) {
	const [state, dispatch] = useReducer(improveDialogReducer, { feedback: "" });

	function handleSubmit() {
		if (!deployment.repoUrl || !onStartImproveScan) return;
		const template = [
			`Analyze: shape=${results.deploy_shape}, build=${results.build_status}.`,
			`Units: ${results.deploy_units.map((u) => u.name).join(", ") || "none"}.`,
			results.deploy_briefing ? `Briefing excerpt: ${results.deploy_briefing.slice(0, 400)}` : "",
			"Please improve the Railpack plan or build outcome.",
		]
			.filter(Boolean)
			.join("\n");
		const feedback = state.feedback.trim()
			? `${template}\n\nAdditional feedback: ${state.feedback.trim()}`
			: template;

		onStartImproveScan({
			repoUrl: deployment.repoUrl,
			commitSha: results.commit_sha || (deployment.commitSha ?? undefined),
			packagePath,
			feedback,
			failedArtifactScope: "general",
		});
		dispatch({ type: "reset" });
		onOpenChange(false);
	}

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) dispatch({ type: "reset" });
				onOpenChange(nextOpen);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Improve scan results</AlertDialogTitle>
					<AlertDialogDescription>
						Send feedback to sd-artifacts to refine the Railpack plan and build outcome.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<Textarea
					placeholder="e.g. Pin Node 20, fix monorepo filter, add health check..."
					value={state.feedback}
					onChange={(e) => dispatch({ type: "set_feedback", value: e.target.value })}
					className="min-h-24"
				/>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<Button onClick={handleSubmit} disabled={!onStartImproveScan}>
						Send feedback
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
