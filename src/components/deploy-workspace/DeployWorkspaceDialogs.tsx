import { ConfirmDialog } from "@/components/ConfirmDialog";

type DeployWorkspaceDialogsProps = {
	dialogState: {
		showRejectConfirm: boolean;
		showDeleteConfirm: boolean;
		isChangingDeploymentState: boolean;
		showPauseResumeConfirm: boolean;
		showRollbackConfirm: boolean;
	};
	onRejectConfirmOpenChange: (open: boolean) => void;
	onConfirmRejectScan: () => void;
	onDeleteConfirmOpenChange: (open: boolean) => void;
	onConfirmDeleteDeployment: () => void;
	onPauseResumeConfirmOpenChange: (open: boolean) => void;
	onConfirmPauseResumeDeployment: () => void;
	pauseResumeDialogTitle: string;
	pauseResumeDialogDescription: string;
	pauseResumeConfirmText: string;
	onRollbackConfirmOpenChange: (open: boolean) => void;
	onConfirmRollbackDeployment: () => void;
	rollbackCommitSha?: string | null;
};

export default function DeployWorkspaceDialogs({
	dialogState,
	onRejectConfirmOpenChange,
	onConfirmRejectScan,
	onDeleteConfirmOpenChange,
	onConfirmDeleteDeployment,
	onPauseResumeConfirmOpenChange,
	onConfirmPauseResumeDeployment,
	pauseResumeDialogTitle,
	pauseResumeDialogDescription,
	pauseResumeConfirmText,
	onRollbackConfirmOpenChange,
	onConfirmRollbackDeployment,
	rollbackCommitSha,
}: DeployWorkspaceDialogsProps) {
	return (
		<>
			<ConfirmDialog
				open={dialogState.showRejectConfirm}
				onOpenChange={onRejectConfirmOpenChange}
				onConfirm={onConfirmRejectScan}
				title="Reject Analysis?"
				description="This will clear all generated infrastructure files (Dockerfiles, Docker Compose, etc.) and revert this service to its pre-scan state. This action cannot be undone."
				confirmText="Reject Analysis"
				variant="destructive"
			/>
			<ConfirmDialog
				open={dialogState.showDeleteConfirm}
				onOpenChange={onDeleteConfirmOpenChange}
				onConfirm={onConfirmDeleteDeployment}
				title="Delete Deployment?"
				description="This permanently removes the deployment and its tracked runtime state. You can deploy again later, but this current deployment record will be deleted."
				confirmText={dialogState.isChangingDeploymentState ? "Deleting..." : "Delete Deployment"}
				variant="destructive"
			/>
			<ConfirmDialog
				open={dialogState.showPauseResumeConfirm}
				onOpenChange={onPauseResumeConfirmOpenChange}
				onConfirm={onConfirmPauseResumeDeployment}
				title={pauseResumeDialogTitle}
				description={pauseResumeDialogDescription}
				confirmText={pauseResumeConfirmText}
				variant="default"
			/>
			<ConfirmDialog
				open={dialogState.showRollbackConfirm}
				onOpenChange={onRollbackConfirmOpenChange}
				onConfirm={onConfirmRollbackDeployment}
				title="Rollback Deployment?"
				description={
					rollbackCommitSha
						? `This will redeploy the release from commit ${rollbackCommitSha.slice(0, 7)} while keeping current environment variables.`
						: "This will redeploy the selected release while keeping current environment variables."
				}
				confirmText={dialogState.isChangingDeploymentState ? "Rolling back..." : "Rollback Release"}
				variant="default"
			/>
		</>
	);
}
