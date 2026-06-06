import type { DeployConfig, DeploymentHistoryEntry } from "@/app/types";

export type DeploymentHistoryPageData = {
	history: DeploymentHistoryEntry[];
	total: number;
};

export type DeploymentHistoryProps = {
	repoName: string;
	serviceName: string;
	prefetchedData?: DeploymentHistoryPageData | DeploymentHistoryEntry[] | null;
	isPrefetching?: boolean;
	onRollback?: (entry: DeploymentHistoryEntry) => void;
	rollbackingEntryId?: string | null;
	activeDeployment?: DeployConfig | null;
	activeDeploymentStatus?: DeployConfig["status"] | null;
};
