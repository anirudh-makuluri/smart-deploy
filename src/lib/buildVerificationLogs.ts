import type {
	SDAnalyzeBuildStatus,
	SDArtifactsResponse,
	SDBuildVerification,
	SDRepairAttempt,
} from "@/app/types";
import type { LogEntry } from "@/components/service-logs/types";

export type BuildVerificationUiStatus = "passed" | "failed" | "skipped" | "unknown";

export type BuildLogSource = {
	id: string;
	label: string;
	result?: string;
	excerpt: string;
};

export function resolveBuildVerificationUiStatus(
	buildStatus: SDAnalyzeBuildStatus | undefined,
	verification?: SDBuildVerification | null,
): BuildVerificationUiStatus {
	const status = verification?.status?.toLowerCase();
	if (status === "passed") return "passed";
	if (status === "failed") return "failed";
	if (status === "skipped" || buildStatus === "skipped") return "skipped";
	if (buildStatus === "passed" || buildStatus === "partial") return "passed";
	if (buildStatus === "failed" || buildStatus === "error") return "failed";
	return "unknown";
}

export function collectBuildLogSources(
	verification?: SDBuildVerification | null,
	repairHistory?: SDRepairAttempt[] | null,
): BuildLogSource[] {
	const sources: BuildLogSource[] = [];
	const verificationExcerpt = verification?.log_excerpt?.trim() ?? "";

	if (verificationExcerpt) {
		sources.push({
			id: "verification",
			label: "Verification",
			result: verification?.status,
			excerpt: verificationExcerpt,
		});
	}

	for (const [index, attempt] of (repairHistory ?? []).entries()) {
		const excerpt = attempt.build_log_excerpt?.trim() ?? "";
		if (!excerpt) continue;
		const attemptNo = attempt.attempt ?? index + 1;
		sources.push({
			id: `repair-${attemptNo}`,
			label: `Repair attempt ${attemptNo}`,
			result: attempt.result,
			excerpt,
		});
	}

	if (sources.length <= 1) return sources;

	const seen = new Set<string>();
	return sources.filter((source) => {
		if (seen.has(source.excerpt)) return false;
		seen.add(source.excerpt);
		return true;
	});
}

export function parseBuildLogExcerpt(excerpt: string): LogEntry[] {
	if (!excerpt.trim()) return [];
	return excerpt
		.split(/\r?\n/)
		.map((line) => line.replace(/\r$/, ""))
		.filter((line) => line.length > 0)
		.map((message) => ({ message }));
}

export function formatBuildVerificationDuration(seconds?: number): string | null {
	if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const mins = Math.floor(seconds / 60);
	const secs = Math.round(seconds % 60);
	return `${mins}m ${secs}s`;
}

export function shouldShowBuildVerificationPanel(results: SDArtifactsResponse): boolean {
	return Boolean(
		results.build_verification ||
			(results.repair_history?.length ?? 0) > 0 ||
			results.build_status === "passed" ||
			results.build_status === "failed" ||
			results.build_status === "skipped" ||
			results.build_status === "partial",
	);
}
