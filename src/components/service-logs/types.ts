export type LogEntry = { timestamp?: string; message?: string };

export type LogFilter = "ALL" | "ERROR" | "WARN" | "BUILD" | "DEPLOY";

export type KeywordRule = { mode: "include" | "exclude"; keyword: string };

export type LogListState = {
	scopeKey: string;
	extraHistory: LogEntry[];
	hasMoreHistory: boolean;
	visiblePages: number;
};

export type ServiceLogsProps = {
	logs: LogEntry[];
	serviceName?: string;
	repoName?: string;
	deployStatus?: string;
	displayLimit?: number;
	scrollable?: boolean;
	[key: string]: unknown;
};
