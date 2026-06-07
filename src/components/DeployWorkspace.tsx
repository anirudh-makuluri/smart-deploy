"use client";

import DeployWorkspaceMenu from "@/components/deploy-workspace/DeployWorkspaceMenu";
import DeployWorkspaceActiveSection from "@/components/deploy-workspace/DeployWorkspaceActiveSection";
import DeployWorkspaceDeployButton from "@/components/deploy-workspace/DeployWorkspaceDeployButton";
import DeployWorkspaceDialogs from "@/components/deploy-workspace/DeployWorkspaceDialogs";
import { useDeployWorkspace } from "@/components/deploy-workspace/useDeployWorkspace";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export type DeployWorkspaceProps = {
	mobileNavOpen?: boolean;
	onMobileNavOpenChange?: (open: boolean) => void;
};

function ServiceNotFound() {
	return (
		<div className="landing-bg min-h-svh flex flex-col items-center justify-center gap-4 text-foreground">
			<p className="text-muted-foreground">Service not found</p>
		</div>
	);
}

export default function DeployWorkspace({
	mobileNavOpen = false,
	onMobileNavOpenChange,
}: DeployWorkspaceProps = {}) {
	const workspace = useDeployWorkspace();

	if (workspace.missingService || workspace.repoNotFound) {
		return <ServiceNotFound />;
	}

	const {
		ui,
		dispatch,
		repoRecord,
		currentServiceName,
		deploymentConfig,
		repoUrl,
		repoName,
		repoIdentifier,
		analyzeServicePath,
		effectiveBranch,
		hasScanResults,
		deployDisabled,
		deploymentInProgress,
		deployDisabledMessage,
		effectiveDeploymentStatus,
		effectiveScanResults,
		deploymentHistory,
		historyTotal,
		isLoadingHistory,
		showDeployLogs,
		deployLogEntries,
		serviceLogs,
		effectiveDeployStatus,
		deployError,
		steps,
		liveDeployConfig,
		isRefreshingPreview,
		pauseResumeDialogTitle,
		pauseResumeDialogDescription,
		pauseResumeConfirmText,
		setActiveSection,
		onScanComplete,
		handleScanProgressComplete,
		handleImproveScanComplete,
		handleImproveScanCancel,
		handleDeploy,
		handleRejectScan,
		onStartImproveScan,
		startScan,
		handleRollbackEntrySelect,
		handleConfigChange,
		persistScanResults,
		handleManualCreatePreview,
		handleConfirmRejectScan,
		handleDeleteDeployment,
		handlePauseResumeDeployment,
		handleRollbackDeployment,
	} = workspace;

	const deployAction = (
		<DeployWorkspaceDeployButton
			hasScanResults={hasScanResults}
			isDeploying={ui.isDeploying}
			deployDisabled={deployDisabled}
			deploymentInProgress={deploymentInProgress}
			deployDisabledMessage={deployDisabledMessage}
			isSidebarCollapsed={ui.isSidebarCollapsed}
			onDeploy={() => void handleDeploy()}
		/>
	);

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-background/30 text-foreground dot-grid-bg">
			<div className="border-b border-white/5 bg-background/50 backdrop-blur-md sticky top-0 z-10 transition-all">
				<div className="mx-auto flex max-w-6xl items-center justify-end px-6 py-4 md:justify-end">
					<div className="w-full max-w-[164px] md:hidden">{deployAction}</div>
				</div>
			</div>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<aside
					className={`hidden h-full shrink-0 border-r border-white/6 bg-background/22 backdrop-blur-sm transition-[width] duration-200 md:block ${ui.isSidebarCollapsed ? "w-20" : "w-60"}`}
				>
					<DeployWorkspaceMenu
						activeSection={ui.activeSection}
						onChange={setActiveSection}
						footer={deployAction}
						collapsed={ui.isSidebarCollapsed}
						onToggleCollapsed={() => dispatch({ type: "toggle_sidebar_collapsed" })}
						deploymentKind="container"
					/>
				</aside>
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<main
						className="min-h-0 flex-1 overflow-auto stealth-scrollbar"
					>
						<DeployWorkspaceActiveSection
							activeSection={ui.activeSection}
							improveScanPayload={ui.improveScanPayload}
							scanMode={ui.scanMode}
							repoUrl={repoUrl}
							analyzeServicePath={analyzeServicePath}
							effectiveBranch={effectiveBranch}
							repoName={repoName}
							serviceName={currentServiceName}
							onScanComplete={onScanComplete}
							onScanProgressComplete={handleScanProgressComplete}
							onScanCancel={() => dispatch({ type: "set_scan_mode", value: "idle" })}
							onImproveScanComplete={handleImproveScanComplete}
							onImproveScanCancel={handleImproveScanCancel}
							hasScanResults={hasScanResults}
							effectiveScanResults={effectiveScanResults}
							scanDuration={ui.scanDuration}
							deployment={deploymentConfig}
							onStartDeployment={() => void handleDeploy()}
							onRejectScan={handleRejectScan}
							onStartImproveScan={onStartImproveScan}
							onStartScan={startScan}
							deploymentHistory={deploymentHistory}
							historyTotal={historyTotal}
							isLoadingHistory={isLoadingHistory}
							onRollbackEntrySelect={handleRollbackEntrySelect}
							rollbackingEntryId={ui.isChangingDeploymentState ? ui.rollbackEntry?.id ?? null : null}
							effectiveDeploymentStatus={effectiveDeploymentStatus}
							repoRecord={repoRecord!}
							repoIdentifier={repoIdentifier}
							currentServiceName={currentServiceName}
							onConfigChange={handleConfigChange}
							onPersistScanResults={persistScanResults}
							showDeployLogs={showDeployLogs}
							deployLogEntries={deployLogEntries}
							serviceLogs={serviceLogs}
							effectiveDeployStatus={effectiveDeployStatus}
							deployError={deployError}
							deployingCommitInfo={ui.deployingCommitInfo}
							steps={steps}
							liveDeployConfig={liveDeployConfig}
							isDeploying={ui.isDeploying}
							isRefreshingPreview={isRefreshingPreview}
							onRedeploy={handleDeploy}
							onRefreshPreview={handleManualCreatePreview}
							onEditConfiguration={() => setActiveSection("setup")}
							onOpenScanSection={() => setActiveSection("scan")}
							onPauseResumeDeployment={() => dispatch({ type: "set_show_pause_resume_confirm", value: true })}
							onDeleteDeployment={() => dispatch({ type: "set_show_delete_confirm", value: true })}
							isChangingDeploymentState={ui.isChangingDeploymentState}
							activeRepo={repoRecord!}
							deployDisabled={deployDisabled}
							deployDisabledMessage={deployDisabledMessage}
						/>
					</main>
				</div>
			</div>

			{onMobileNavOpenChange ? (
				<Sheet open={mobileNavOpen} onOpenChange={onMobileNavOpenChange}>
					<SheetContent
						side="left"
						className="z-100 flex w-[min(20rem,calc(100vw-2rem))] max-w-[20rem] flex-col gap-0 border-r border-white/10 bg-background/95 p-0 backdrop-blur-xl [&>button]:text-foreground"
					>
						<SheetTitle className="sr-only">Deploy workspace navigation</SheetTitle>
						<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
							<DeployWorkspaceMenu
								activeSection={ui.activeSection}
								onChange={(section) => {
									setActiveSection(section);
									onMobileNavOpenChange(false);
								}}
								footer={deployAction}
								collapsed={false}
								deploymentKind="container"
							/>
						</div>
					</SheetContent>
				</Sheet>
			) : null}

			<DeployWorkspaceDialogs
				showRejectConfirm={ui.showRejectConfirm}
				onRejectConfirmOpenChange={(open) => dispatch({ type: "set_show_reject_confirm", value: open })}
				onConfirmRejectScan={() => void handleConfirmRejectScan()}
				showDeleteConfirm={ui.showDeleteConfirm}
				onDeleteConfirmOpenChange={(open) => dispatch({ type: "set_show_delete_confirm", value: open })}
				onConfirmDeleteDeployment={() => void handleDeleteDeployment()}
				isChangingDeploymentState={ui.isChangingDeploymentState}
				showPauseResumeConfirm={ui.showPauseResumeConfirm}
				onPauseResumeConfirmOpenChange={(open) => dispatch({ type: "set_show_pause_resume_confirm", value: open })}
				onConfirmPauseResumeDeployment={() => void handlePauseResumeDeployment()}
				pauseResumeDialogTitle={pauseResumeDialogTitle}
				pauseResumeDialogDescription={pauseResumeDialogDescription}
				pauseResumeConfirmText={pauseResumeConfirmText}
				effectiveDeploymentStatus={effectiveDeploymentStatus}
				showRollbackConfirm={ui.showRollbackConfirm}
				onRollbackConfirmOpenChange={(open) => dispatch({ type: "set_show_rollback_confirm", value: open })}
				onConfirmRollbackDeployment={() => void handleRollbackDeployment()}
				rollbackCommitSha={ui.rollbackEntry?.commitSha}
			/>
		</div>
	);
}
