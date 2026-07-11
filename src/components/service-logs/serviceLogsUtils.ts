import type { KeywordRule, LogEntry, LogFilter } from "@/components/service-logs/types";

export const LOG_FILTER_STORAGE_KEY = "sd-log-keyword-filters:v1";
export const PAGE_SIZE = 50;

export function getLogType(message: string): "ERROR" | "WARN" | "SUCCESS" | "INFO" {
	const normalized = message.toLowerCase();
	if (normalized.includes("error") || normalized.includes("failed") || normalized.includes("exception")) {
		return "ERROR";
	}
	if (normalized.includes("warn")) {
		return "WARN";
	}
	if (normalized.includes("success") || normalized.includes("completed") || normalized.includes("deployed")) {
		return "SUCCESS";
	}
	return "INFO";
}

export function formatTimeOnly(timestamp?: string): string {
	if (!timestamp) return "-";
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "-";
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	const seconds = String(date.getSeconds()).padStart(2, "0");
	return `${hours}:${minutes}:${seconds}`;
}

export function getLogMessage(log: LogEntry): string {
	return typeof log.message === "string" ? log.message : JSON.stringify(log.message);
}

export function logKey(log: LogEntry): string {
	const ts = log.timestamp ?? "";
	const msg = getLogMessage(log);
	return `${ts}|${msg}`;
}

export function emptyLogListState(scopeKey: string) {
	return {
		scopeKey,
		extraHistory: [] as LogEntry[],
		hasMoreHistory: true,
		visiblePages: 1,
	};
}

export function loadKeywordRulesFromStorage(): KeywordRule[] {
	if (typeof window === "undefined") return [];
	try {
		const stored = localStorage.getItem(LOG_FILTER_STORAGE_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

export function shouldShowFilterInputInitially(): boolean {
	if (typeof window === "undefined") return false;
	try {
		const stored = localStorage.getItem(LOG_FILTER_STORAGE_KEY);
		const rules: KeywordRule[] = stored ? JSON.parse(stored) : [];
		return rules.length > 0;
	} catch {
		return false;
	}
}

export function persistKeywordRules(rules: KeywordRule[]) {
	try {
		if (rules.length > 0) {
			localStorage.setItem(LOG_FILTER_STORAGE_KEY, JSON.stringify(rules));
		} else {
			localStorage.removeItem(LOG_FILTER_STORAGE_KEY);
		}
	} catch {
		/* quota or SSR */
	}
}

export function combineLogs(extraHistory: LogEntry[], logs: LogEntry[]): LogEntry[] {
	const seen = new Set<string>();
	const out: LogEntry[] = [];

	for (const l of extraHistory) {
		const k = logKey(l);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(l);
	}

	for (const l of logs) {
		const k = logKey(l);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(l);
	}

	return out;
}

export function limitLogs(combinedLogs: LogEntry[], displayLimit: number | undefined, visiblePages: number): LogEntry[] {
	if (!displayLimit || displayLimit <= 0) return combinedLogs;
	const visibleCount = displayLimit * visiblePages;
	return combinedLogs.slice(-visibleCount);
}

export function filterLogs(
	limitedLogs: LogEntry[],
	logFilter: LogFilter,
	keywordRules: KeywordRule[]
): LogEntry[] {
	const includeRules = keywordRules.filter((r) => r.mode === "include");
	const excludeRules = keywordRules.filter((r) => r.mode === "exclude");

	return limitedLogs.filter((log) => {
		const msg = getLogMessage(log);
		const msgLower = (msg || "").toLowerCase();

		if (logFilter !== "ALL") {
			const type = getLogType(msg || "");
			if (logFilter === "ERROR" && type !== "ERROR") return false;
			if (logFilter === "WARN" && type !== "WARN" && type !== "ERROR") return false;
			if (logFilter === "BUILD" && !(/build|codebuild|docker/i.test(msg))) return false;
			if (logFilter === "DEPLOY" && !(/deploy|ssm|ecr/i.test(msg))) return false;
		}

		if (includeRules.length > 0) {
			const matchesAny = includeRules.some((r) => msgLower.includes(r.keyword.toLowerCase()));
			if (!matchesAny) return false;
		}

		if (excludeRules.length > 0) {
			const matchesExclude = excludeRules.some((r) => msgLower.includes(r.keyword.toLowerCase()));
			if (matchesExclude) return false;
		}

		return true;
	});
}

export function findFirstErrorIndex(filteredLogs: LogEntry[]): number {
	return filteredLogs.findIndex((log) => {
		const msg = typeof log.message === "string" ? log.message : "";
		return getLogType(msg) === "ERROR";
	});
}

export function buildLogExportLines(logs: LogEntry[]): string[] {
	return logs.map((log) => {
		const message = getLogMessage(log);
		const type = getLogType(message || "");
		const time = log.timestamp ? new Date(log.timestamp).toISOString() : "-";
		return `[${time}] [${type}] ${message || "-"}`;
	});
}
