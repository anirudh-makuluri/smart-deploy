export function makeRuntimeStoreKey(
	userID: string | undefined,
	repoName: string,
	serviceName: string
): string {
	return `${userID ?? "anonymous"}:${repoName}:${serviceName}`;
}
