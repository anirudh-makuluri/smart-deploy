"use client";

import PreviewModeView from "@/components/blueprint/PreviewModeView";
import type { DeployConfig, SDArtifactsResponse } from "@/app/types";

type BlueprintViewProps = {
	deployment: DeployConfig;
	scanResults: SDArtifactsResponse | null;
	branchOptions: string[];
	onUpdateDeployment: (partial: Partial<DeployConfig>) => Promise<void> | void;
	onUpdateScanResults: (updater: (current: SDArtifactsResponse) => SDArtifactsResponse) => Promise<void> | void;
};

export default function BlueprintView(props: BlueprintViewProps) {
	return <PreviewModeView {...props} />;
}

