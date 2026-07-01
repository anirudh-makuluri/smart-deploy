import { normalizeDeploymentStatus } from "@/lib/deploymentStatus";

type StatusDisplay = {
	label: string;
	dotClassName: string;
	badgeClassName: string;
};

const deploymentStatusDisplay: Record<string, StatusDisplay> = {
	running: {
		label: "Running",
		dotClassName: "bg-emerald-500",
		badgeClassName: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
	},
	deploying: {
		label: "Deploying",
		dotClassName: "bg-sky-500 animate-pulse",
		badgeClassName: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
	},
	failed: {
		label: "Failed",
		dotClassName: "bg-destructive",
		badgeClassName: "border-destructive/40 bg-destructive/10 text-destructive",
	},
	paused: {
		label: "Paused",
		dotClassName: "bg-amber-500",
		badgeClassName: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
	},
	stopped: {
		label: "Stopped",
		dotClassName: "bg-muted-foreground",
		badgeClassName: "border-border bg-muted text-muted-foreground",
	},
	didnt_deploy: {
		label: "Not deployed",
		dotClassName: "bg-muted-foreground/60",
		badgeClassName: "border-border bg-muted text-muted-foreground",
	},
};

const healthStatusDisplay: Record<string, StatusDisplay> = {
	healthy: {
		label: "Healthy",
		dotClassName: "bg-emerald-500",
		badgeClassName: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
	},
	degraded: {
		label: "Degraded",
		dotClassName: "bg-amber-500",
		badgeClassName: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
	},
	unreachable: {
		label: "Unreachable",
		dotClassName: "bg-destructive",
		badgeClassName: "border-destructive/40 bg-destructive/10 text-destructive",
	},
	unknown: {
		label: "Unknown",
		dotClassName: "bg-muted-foreground",
		badgeClassName: "border-border bg-muted text-muted-foreground",
	},
};

export function getDeploymentStatusDisplay(status: string): StatusDisplay {
	const normalized = normalizeDeploymentStatus(status);
	return deploymentStatusDisplay[normalized] ?? deploymentStatusDisplay.didnt_deploy;
}

export function getHealthStatusDisplay(status: string): StatusDisplay {
	const normalized = status.trim().toLowerCase();
	return healthStatusDisplay[normalized] ?? healthStatusDisplay.unknown;
}

export function shortCommitSha(commitSha: string | null): string {
	if (!commitSha) return "—";
	return commitSha.slice(0, 7);
}
