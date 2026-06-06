import DeploymentHistoryTable from "@/components/DeploymentHistoryTable";

export default function DashboardDeploymentsView() {
	return (
		<div className="space-y-4">
			<div>
				<h2 className="text-lg font-semibold text-foreground">Deployment History</h2>
				<p className="text-sm text-muted-foreground">All services, newest first</p>
			</div>
			<DeploymentHistoryTable />
		</div>
	);
}
