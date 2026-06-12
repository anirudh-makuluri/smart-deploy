import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, ServerCog, Users } from "lucide-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAdminSession } from "@/lib/admin";
import { getSupabaseServer } from "@/lib/supabaseServer";
import { buildWebSocketHealthUrl } from "@/lib/wsUrls";

type ServiceStatus = {
	name: string;
	status: "healthy" | "degraded" | "unavailable";
	message: string;
};

type StatCard = {
	label: string;
	value: number;
	detail: string;
	icon: React.ComponentType<{ className?: string }>;
};

async function countRows(table: string, apply?: (query: any) => any): Promise<number> {
	let query = getSupabaseServer().from(table).select("id", { count: "exact", head: true });
	if (apply) query = apply(query);
	const { count, error } = await query;
	if (error) throw new Error(error.message);
	return count ?? 0;
}

async function checkSupabase(): Promise<ServiceStatus> {
	try {
		const { error } = await getSupabaseServer().from("_health").select("id").limit(1).maybeSingle();
		if (error) throw new Error(error.message);
		return { name: "Supabase", status: "healthy", message: "Service-role database check passed" };
	} catch (error) {
		return {
			name: "Supabase",
			status: "unavailable",
			message: error instanceof Error ? error.message : "Database health check failed",
		};
	}
}

async function checkSdArtifacts(): Promise<ServiceStatus> {
	const baseUrl = process.env.SD_API_BASE_URL;
	const bearerToken = process.env.SD_API_BEARER_TOKEN;
	if (!baseUrl || !bearerToken) {
		return {
			name: "SD Artifacts",
			status: "unavailable",
			message: "SD_API_BASE_URL or SD_API_BEARER_TOKEN is not configured",
		};
	}

	try {
		const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/healthz`, {
			cache: "no-store",
			headers: { Authorization: `Bearer ${bearerToken}` },
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const payload = (await response.json()) as { ok?: boolean; status?: string };
		const healthy = payload.ok !== false && payload.status !== "unhealthy";
		return {
			name: "SD Artifacts",
			status: healthy ? "healthy" : "degraded",
			message: healthy ? "Authenticated health check passed" : "Health endpoint returned degraded state",
		};
	} catch (error) {
		return {
			name: "SD Artifacts",
			status: "unavailable",
			message: error instanceof Error ? error.message : "Health endpoint unavailable",
		};
	}
}

async function checkWorker(): Promise<ServiceStatus> {
	const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
	if (!wsUrl) {
		return {
			name: "WebSocket worker",
			status: "unavailable",
			message: "NEXT_PUBLIC_WS_URL is not configured",
		};
	}

	try {
		const response = await fetch(buildWebSocketHealthUrl(wsUrl, "/health"), { cache: "no-store" });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const payload = (await response.json()) as { ok?: boolean; service?: string };
		return {
			name: "WebSocket worker",
			status: payload.ok === false ? "degraded" : "healthy",
			message: payload.service ? `${payload.service} health check passed` : "Worker health check passed",
		};
	} catch (error) {
		return {
			name: "WebSocket worker",
			status: "unavailable",
			message: error instanceof Error ? error.message : "Worker health endpoint unavailable",
		};
	}
}

async function loadStats(): Promise<StatCard[]> {
	const [
		pendingUsers,
		approvedUsers,
		deployments,
		runningDeployments,
		deployRuns,
		failedRuns,
		newReports,
	] = await Promise.all([
		countRows("waiting_list"),
		countRows("approved_users"),
		countRows("deployments"),
		countRows("deployments", (query) => query.eq("status", "running")),
		countRows("deployment_runs"),
		countRows("deployment_runs", (query) => query.eq("success", false)),
		countRows("user_reports", (query) => query.eq("status", "new")),
	]);

	return [
		{ label: "Pending users", value: pendingUsers, detail: `${approvedUsers} approved`, icon: Users },
		{ label: "Deployments", value: deployments, detail: `${runningDeployments} running`, icon: Activity },
		{ label: "Deploy runs", value: deployRuns, detail: `${failedRuns} failed`, icon: Clock3 },
		{ label: "New reports", value: newReports, detail: "Awaiting triage", icon: AlertTriangle },
	];
}

function statusClass(status: ServiceStatus["status"]) {
	if (status === "healthy") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
	if (status === "degraded") return "border-amber-400/30 bg-amber-400/10 text-amber-200";
	return "border-red-400/30 bg-red-400/10 text-red-200";
}

export default async function AdminSystemPage() {
	await requireAdminSession();
	const [services, stats] = await Promise.all([
		Promise.all([checkSupabase(), checkSdArtifacts(), checkWorker()]),
		loadStats(),
	]);
	const healthyCount = services.filter((service) => service.status === "healthy").length;

	return (
		<section className="space-y-5">
			<div>
				<h1 className="text-2xl font-semibold tracking-normal">System</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Operational health, table counts, and worker connectivity checks.
				</p>
			</div>

			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				{stats.map((stat) => {
					const Icon = stat.icon;
					return (
						<Card key={stat.label} className="rounded-lg border-white/10 bg-card/80">
							<CardContent className="flex items-center gap-4 p-5">
								<span className="flex size-10 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
									<Icon className="size-5" />
								</span>
								<div className="min-w-0">
									<p className="text-xs text-muted-foreground">{stat.label}</p>
									<p className="text-2xl font-semibold">{stat.value}</p>
									<p className="truncate text-xs text-muted-foreground">{stat.detail}</p>
								</div>
							</CardContent>
						</Card>
					);
				})}
			</div>

			<Card className="rounded-lg border-white/10 bg-card/80">
				<CardHeader className="border-b border-white/10">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<CardTitle>Service health</CardTitle>
							<CardDescription>Fresh server-side checks for the main operational dependencies.</CardDescription>
						</div>
						<Badge className="w-fit rounded-md border border-white/10 bg-white/5 font-mono text-muted-foreground">
							{healthyCount}/{services.length} healthy
						</Badge>
					</div>
				</CardHeader>
				<CardContent className="grid gap-3 pt-6 lg:grid-cols-3">
					{services.map((service) => (
						<div key={service.name} className="rounded-lg border border-white/10 bg-black/20 p-4">
							<div className="flex items-start justify-between gap-3">
								<div className="flex items-center gap-3">
									<span className="flex size-9 items-center justify-center rounded-md border border-white/10 bg-white/5">
										{service.status === "healthy" ? (
											<CheckCircle2 className="size-5 text-emerald-300" />
										) : service.name === "Supabase" ? (
											<Database className="size-5 text-red-300" />
										) : (
											<ServerCog className="size-5 text-amber-300" />
										)}
									</span>
									<h2 className="font-medium">{service.name}</h2>
								</div>
								<Badge className={`rounded-md border font-mono text-[11px] ${statusClass(service.status)}`}>
									{service.status}
								</Badge>
							</div>
							<p className="mt-3 text-sm text-muted-foreground">{service.message}</p>
						</div>
					))}
				</CardContent>
			</Card>
		</section>
	);
}
