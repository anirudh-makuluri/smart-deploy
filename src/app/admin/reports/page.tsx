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

const reportColumns: AdminTableColumn[] = [
	{ key: "id", label: "ID", tone: "mono" },
	{ key: "created_at", label: "Created", tone: "mono" },
	{ key: "status", label: "Status", tone: "status" },
	{ key: "category", label: "Category", tone: "status" },
	{ key: "message", label: "Message", tone: "long" },
	{ key: "user_email", label: "Email" },
	{ key: "user_name", label: "Name" },
	{ key: "user_id", label: "User ID", tone: "mono" },
	{ key: "page_path", label: "Page" },
	{ key: "repo_owner", label: "Owner" },
	{ key: "repo_name", label: "Repo" },
	{ key: "service_name", label: "Service" },
];

async function loadReports(): Promise<Record<string, AdminScalar>[]> {
	const { data, error } = await getSupabaseServer()
		.from("user_reports")
		.select(
			[
				"id",
				"created_at",
				"status",
				"category",
				"message",
				"user_email",
				"user_name",
				"user_id",
				"page_path",
				"repo_owner",
				"repo_name",
				"service_name",
			].join(",")
		)
		.order("created_at", { ascending: false })
		.limit(1000);
	if (error) throw new Error(error.message);
	return (data ?? []) as unknown as Record<string, AdminScalar>[];
}

export default async function AdminReportsPage() {
	await requireAdminSession();
	const rows = await loadReports();

	return (
		<section className="space-y-5">
			<div>
				<h1 className="text-2xl font-semibold tracking-normal">Reports</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					User-submitted bug reports, feature requests, and product feedback.
				</p>
			</div>

			<Card className="rounded-lg border-white/10 bg-card/80">
				<CardHeader className="border-b border-white/10">
					<CardTitle>User reports</CardTitle>
					<CardDescription>Report contents without the metadata JSONB payload.</CardDescription>
				</CardHeader>
				<CardContent className="pt-6">
					<AdminDataTable
						columns={reportColumns}
						rows={rows}
						emptyMessage="No reports found."
						initialSort="created_at"
					/>
				</CardContent>
			</Card>
		</section>
	);
}
