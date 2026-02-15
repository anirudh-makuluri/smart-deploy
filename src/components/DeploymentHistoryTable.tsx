"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Download, Loader2, Search } from "lucide-react";

const statusOptions = ["all", "success", "failed"] as const;
const envOptions = ["all", "production", "staging", "development"] as const;

type DeploymentHistoryRow = {
	id: string;
	deploymentId: string;
	timestamp: string;
	success: boolean;
	commitSha?: string;
	branch?: string;
	durationMs?: number;
	serviceName: string;
	repoUrl?: string;
	steps: { id: string; label: string; logs: string[]; status: string }[];
	configSnapshot: Record<string, unknown>;
};

function toRelativeTime(timestamp: string): string {
	const now = Date.now();
	const then = new Date(timestamp).getTime();
	if (Number.isNaN(then)) return "--";
	const diff = Math.max(0, now - then);
	const minute = 60 * 1000;
	const hour = 60 * minute;
	const day = 24 * hour;

	if (diff < minute) return "just now";
	if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
	if (diff < day) return `${Math.floor(diff / hour)}h ago`;
	return `${Math.floor(diff / day)}d ago`;
}

function deriveEnvironment(branch?: string): string {
	const value = (branch || "").toLowerCase();
	if (value.includes("stag")) return "Staging";
	if (value.includes("dev") || value.includes("test")) return "Development";
	return "Production";
}

function downloadCsv(rows: DeploymentHistoryRow[]) {
	const headers = ["Status", "Service", "Environment", "Commit", "Branch", "Age", "Timestamp"];
	const lines = rows.map((row) => {
		const status = row.success ? "SUCCESS" : "FAILED";
		const env = deriveEnvironment(row.branch);
		const commit = row.commitSha ? row.commitSha.substring(0, 7) : "";
		const age = toRelativeTime(row.timestamp);
		return [status, row.serviceName, env, commit, row.branch ?? "", age, row.timestamp]
			.map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
			.join(",");
	});
	const csv = [headers.join(","), ...lines].join("\n");
	const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = "deployment-history.csv";
	link.click();
	URL.revokeObjectURL(url);
}

export default function DeploymentHistoryTable() {
	const [history, setHistory] = React.useState<DeploymentHistoryRow[]>([]);
	const [loading, setLoading] = React.useState(true);
	const [query, setQuery] = React.useState("");
	const [statusFilter, setStatusFilter] = React.useState<(typeof statusOptions)[number]>("all");
	const [envFilter, setEnvFilter] = React.useState<(typeof envOptions)[number]>("all");

	React.useEffect(() => {
		setLoading(true);
		fetch("/api/deployment-history/all")
			.then((res) => res.json())
			.then((data) => {
				if (data.status === "success" && Array.isArray(data.history)) {
					setHistory(data.history);
				}
			})
			.finally(() => setLoading(false));
	}, []);

	const filtered = React.useMemo(() => {
		return history.filter((row) => {
			const matchQuery = query
				? `${row.serviceName} ${row.repoUrl ?? ""} ${row.branch ?? ""} ${row.commitSha ?? ""}`
					.toLowerCase()
					.includes(query.toLowerCase())
				: true;
			const matchStatus =
				statusFilter === "all" ||
				(statusFilter === "success" && row.success) ||
				(statusFilter === "failed" && !row.success);
			const env = deriveEnvironment(row.branch).toLowerCase();
			const matchEnv = envFilter === "all" || env === envFilter;
			return matchQuery && matchStatus && matchEnv;
		});
	}, [history, query, statusFilter, envFilter]);

	return (
		<div className="rounded-xl border border-border bg-card/60 p-4">
			<div className="flex flex-wrap items-center gap-3">
				<div className="relative flex-1 min-w-56">
					<Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
					<Input
						placeholder="Filter deployments..."
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="pl-9 border-border bg-background/60"
					/>
				</div>
				<Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusOptions[number])}>
					<SelectTrigger className="w-40 border-border bg-background/60">
						<SelectValue placeholder="All Statuses" />
					</SelectTrigger>
					<SelectContent>
						{statusOptions.map((option) => (
							<SelectItem key={option} value={option}>
								{option === "all" ? "All Statuses" : option}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Select value={envFilter} onValueChange={(value) => setEnvFilter(value as typeof envOptions[number])}>
					<SelectTrigger className="w-44 border-border bg-background/60">
						<SelectValue placeholder="All Environments" />
					</SelectTrigger>
					<SelectContent>
						{envOptions.map((option) => (
							<SelectItem key={option} value={option}>
								{option === "all" ? "All Environments" : option}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					variant="outline"
					className="border-border bg-background/60"
					onClick={() => downloadCsv(filtered)}
					disabled={filtered.length === 0}
				>
					<Download className="size-4 mr-2" />
					Export CSV
				</Button>
			</div>

			<div className="mt-4">
				{loading ? (
					<div className="flex items-center gap-2 text-muted-foreground py-6">
						<Loader2 className="size-4 animate-spin" />
						Loading deployment history...
					</div>
				) : filtered.length === 0 ? (
					<div className="text-sm text-muted-foreground py-6">No deployments match your filters.</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Status</TableHead>
								<TableHead>Service</TableHead>
								<TableHead>Environment</TableHead>
								<TableHead>Commit</TableHead>
								<TableHead>Age</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{filtered.map((row) => (
								<TableRow key={row.id}>
									<TableCell>
										<Badge
											variant="outline"
											className={
												row.success
													? "border-emerald-500/60 text-emerald-400 bg-emerald-500/10"
													: "border-rose-500/60 text-rose-400 bg-rose-500/10"
											}
										>
											{row.success ? "SUCCESS" : "FAILED"}
										</Badge>
									</TableCell>
									<TableCell>
										<div className="text-foreground font-medium">{row.serviceName}</div>
										{row.repoUrl && (
											<div className="text-xs text-muted-foreground truncate max-w-60">{row.repoUrl}</div>
										)}
									</TableCell>
									<TableCell>
										<span className="text-sm text-muted-foreground">
											{deriveEnvironment(row.branch)}
										</span>
									</TableCell>
									<TableCell>
										<div className="text-sm text-foreground">
											{row.commitSha ? row.commitSha.substring(0, 7) : "--"}
										</div>
										{row.branch && (
											<div className="text-xs text-muted-foreground">{row.branch}</div>
										)}
									</TableCell>
									<TableCell>
										<span className="text-sm text-muted-foreground">
											{toRelativeTime(row.timestamp)}
										</span>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</div>
		</div>
	);
}
