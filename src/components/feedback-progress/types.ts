export type FeedbackProgressPayload = {
	repoUrl: string;
	commitSha?: string;
	packagePath?: string;
	feedback: string;
	failureSummary?: string;
	failureLogs?: string;
	failedArtifactScope?: string;
};
