export type GithubPushWebhook = {
	installationId: number;
	repositoryId: number;
	fullName: string;
	repositoryUrl: string;
	branch: string;
	commitSha: string;
};

type GithubPushPayload = {
	ref?: unknown;
	after?: unknown;
	installation?: { id?: unknown };
	repository?: {
		id?: unknown;
		full_name?: unknown;
		html_url?: unknown;
	};
};

function positiveInteger(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
	return value;
}

function nonEmptyString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed || null;
}

export function parseGithubPushWebhook(payload: unknown): GithubPushWebhook | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
	const event = payload as GithubPushPayload;
	const ref = nonEmptyString(event.ref);
	const commitSha = nonEmptyString(event.after);
	const fullName = nonEmptyString(event.repository?.full_name);
	const repositoryUrl = nonEmptyString(event.repository?.html_url);
	const installationId = positiveInteger(event.installation?.id);
	const repositoryId = positiveInteger(event.repository?.id);
	const branchPrefix = "refs/heads/";

	if (
		!ref?.startsWith(branchPrefix) ||
		!commitSha ||
		!/^[0-9a-f]{40,64}$/i.test(commitSha) ||
		/^0+$/.test(commitSha) ||
		!fullName ||
		!repositoryUrl ||
		!installationId ||
		!repositoryId
	) {
		return null;
	}

	const branch = ref.slice(branchPrefix.length).trim();
	if (!branch) return null;

	return { installationId, repositoryId, fullName, repositoryUrl, branch, commitSha };
}
