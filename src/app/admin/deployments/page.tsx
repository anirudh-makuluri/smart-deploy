import { AdminDataTable, type AdminScalar, type AdminTableColumn } from "@/components/admin/AdminDataTable";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { requireAdminSession } from "@/lib/admin";
import { getSupabaseServer } from "@/lib/supabaseServer";

const deploymentColumns: AdminTableColumn[] = [
	{ key: "id", label: "ID", tone: "mono" },
	{ key: "repo_name", label: "Repo" },
	{ key: "repo_url", label: "Repo URL", tone: "long" },
	{ key: "service_name", label: "Service" },
	{ key: "owner_id", label: "Owner", tone: "mono" },
	{ key: "branch", label: "Branch" },
	{ key: "commit_sha", label: "Commit", tone: "mono" },
	{ key: "hosted_subdomain", label: "Subdomain" },
	{ key: "cloud_provider", label: "Provider", tone: "status" },
	{ key: "deployment_target", label: "Target", tone: "status" },
	{ key: "region", label: "Region" },
	{ key: "status", label: "Status", tone: "status" },
	{ key: "first_deployment", label: "First Deploy", tone: "mono" },
	{ key: "last_deployment", label: "Last Deploy", tone: "mono" },
	{ key: "response_id", label: "Response ID", tone: "mono" },
];

async function loadDeployments(): Promise<Record<string, AdminScalar>[]> {
	const { data, error } = await getSupabaseServer()
		.from("deployments")
		.select(
			[
				"id",
				"repo_name",
				"repo_url",
				"service_name",
				"owner_id",
				"branch",
				"commit_sha",
				"hosted_subdomain",
				"screenshot_url",
				"cloud_provider",
				"deployment_target",
				"region",
				"status",
				"first_deployment",
				"last_deployment",
				"revision",
				"secrets_arn",
				"response_id",
			].join(",")
		)
		.order("last_deployment", { ascending: false, nullsFirst: false })
		.limit(1000);
	if (error) throw new Error(error.message);
	const rows = (data ?? []) as unknown as Record<string, AdminScalar>[];
	return rows.map((row) => ({
		...row,
		revision: typeof row.revision === "number" ? row.revision : null,
	}));
}

export default async function AdminDeploymentsPage() {
	await requireAdminSession();
	const rows = await loadDeployments();

	return (
		<section className="space-y-5">
			<div>
				<h1 className="text-2xl font-semibold tracking-normal">Deployments</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Active deployment rows with scalar Supabase columns only.
				</p>
			</div>

			<Card className="rounded-lg border-white/10 bg-card/80">
				<CardHeader className="border-b border-white/10">
					<CardTitle>Deployment records</CardTitle>
					<CardDescription>Filter and sort across the non-JSONB deployment fields.</CardDescription>
				</CardHeader>
				<CardContent className="pt-6">
					<AdminDataTable
						columns={deploymentColumns}
						rows={rows}
						emptyMessage="No deployments found."
						initialSort="last_deployment"
					/>
				</CardContent>
			</Card>
		</section>
	);
}
