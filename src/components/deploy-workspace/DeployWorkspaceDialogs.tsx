import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { DeployConfig } from "@/app/types";

type DeployWorkspaceDialogsProps = {
	showRejectConfirm: boolean;
	onRejectConfirmOpenChange: (open: boolean) => void;
	onConfirmRejectScan: () => void;
	showDeleteConfirm: boolean;
	onDeleteConfirmOpenChange: (open: boolean) => void;
	onConfirmDeleteDeployment: () => void;
	isChangingDeploymentState: boolean;
	showPauseResumeConfirm: boolean;
	onPauseResumeConfirmOpenChange: (open: boolean) => void;
	onConfirmPauseResumeDeployment: () => void;
	pauseResumeDialogTitle: string;
	pauseResumeDialogDescription: string;
	pauseResumeConfirmText: string;
	effectiveDeploymentStatus: DeployConfig["status"];
	showRollbackConfirm: boolean;
	onRollbackConfirmOpenChange: (open: boolean) => void;
	onConfirmRollbackDeployment: () => void;
	rollbackCommitSha?: string | null;
};

export default function DeployWorkspaceDialogs({
	showRejectConfirm,
	onRejectConfirmOpenChange,
	onConfirmRejectScan,
	showDeleteConfirm,
	onDeleteConfirmOpenChange,
	onConfirmDeleteDeployment,
	isChangingDeploymentState,
	showPauseResumeConfirm,
	onPauseResumeConfirmOpenChange,
	onConfirmPauseResumeDeployment,
	pauseResumeDialogTitle,
	pauseResumeDialogDescription,
	pauseResumeConfirmText,
	showRollbackConfirm,
	onRollbackConfirmOpenChange,
	onConfirmRollbackDeployment,
	rollbackCommitSha,
}: DeployWorkspaceDialogsProps) {
	return (
		<>
			<ConfirmDialog
				open={showRejectConfirm}
				onOpenChange={onRejectConfirmOpenChange}
				onConfirm={onConfirmRejectScan}
				title="Reject Analysis?"
				description="This will clear all generated infrastructure files (Dockerfiles, Docker Compose, etc.) and revert this service to its pre-scan state. This action cannot be undone."
				confirmText="Reject Analysis"
				variant="destructive"
			/>
			<ConfirmDialog
				open={showDeleteConfirm}
				onOpenChange={onDeleteConfirmOpenChange}
				onConfirm={onConfirmDeleteDeployment}
				title="Delete Deployment?"
				description="This permanently removes the deployment and its tracked runtime state. You can deploy again later, but this current deployment record will be deleted."
				confirmText={isChangingDeploymentState ? "Deleting..." : "Delete Deployment"}
				variant="destructive"
			/>
			<ConfirmDialog
				open={showPauseResumeConfirm}
				onOpenChange={onPauseResumeConfirmOpenChange}
				onConfirm={onConfirmPauseResumeDeployment}
				title={pauseResumeDialogTitle}
				description={pauseResumeDialogDescription}
				confirmText={pauseResumeConfirmText}
				variant="default"
			/>
			<ConfirmDialog
				open={showRollbackConfirm}
				onOpenChange={onRollbackConfirmOpenChange}
				onConfirm={onConfirmRollbackDeployment}
				title="Rollback Deployment?"
				description={
					rollbackCommitSha
						? `This will redeploy the release from commit ${rollbackCommitSha.slice(0, 7)} while keeping current environment variables.`
						: "This will redeploy the selected release while keeping current environment variables."
				}
				confirmText={isChangingDeploymentState ? "Rolling back..." : "Rollback Release"}
				variant="default"
			/>
		</>
	);
}
