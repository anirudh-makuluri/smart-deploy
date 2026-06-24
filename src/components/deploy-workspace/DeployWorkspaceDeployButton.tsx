import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";

type DeployWorkspaceDeployButtonProps = {
	hasScanResults: boolean;
	isDeploying: boolean;
	deployDisabled: boolean;
	deploymentInProgress: boolean;
	deployDisabledMessage: string;
	isSidebarCollapsed: boolean;
	onDeploy: () => void;
};

export default function DeployWorkspaceDeployButton({
	hasScanResults,
	isDeploying,
	deployDisabled,
	deploymentInProgress,
	deployDisabledMessage,
	isSidebarCollapsed,
	onDeploy,
}: DeployWorkspaceDeployButtonProps) {
	const disabled = !hasScanResults || isDeploying || deployDisabled || deploymentInProgress;
	const tooltipMessage = deploymentInProgress
		? "Deployment already in progress. Open logs to follow along."
		: !hasScanResults || deployDisabled
			? deployDisabledMessage
			: "";

	return (
		<div className="relative group">
			<Button
				disabled={disabled}
				onClick={onDeploy}
				className={`h-10 w-full font-bold gap-2 shadow-lg shadow-primary/20 relative overflow-hidden ${isSidebarCollapsed ? "px-0" : "px-6"}`}
				title={tooltipMessage}
				aria-label="Deploy"
			>
				<Rocket className="size-4 relative z-10" />
				{!isSidebarCollapsed ? <span className="relative z-10">Deploy</span> : null}
			</Button>
			{disabled && tooltipMessage ? (
				<div className={`absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 ${isSidebarCollapsed ? "left-0" : "left-0 right-0"}`}>
					<div className="bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-1 rounded shadow-lg whitespace-nowrap border border-destructive/20 text-center">
						{tooltipMessage}
					</div>
				</div>
			) : null}
		</div>
	);
}
