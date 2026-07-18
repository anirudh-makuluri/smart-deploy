import { execFileSync } from "node:child_process";

export type GitCommandRunner = (args: string[], workdir: string) => string;

export type GitRepositoryContext = {
	rootDirectory: string;
	repoUrl: string;
	branch: string;
	commitSha: string;
	isWorkingTreeClean: boolean;
};

export function normalizeGitHubRemote(remote: string): string {
	const trimmed = remote.trim();
	const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
	const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
	const match = sshMatch ?? httpsMatch;
	if (!match) {
		throw new Error("Smart Deploy currently requires a GitHub origin remote.");
	}
	return `https://github.com/${match[1]}/${match[2]}`;
}

export const runGitCommand: GitCommandRunner = (args, workdir) =>
	execFileSync("git", args, { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export function readGitRepositoryContext(
	workdir: string,
	runCommand: GitCommandRunner = runGitCommand
): GitRepositoryContext {
	try {
		const rootDirectory = runCommand(["rev-parse", "--show-toplevel"], workdir);
		const remote = runCommand(["config", "--get", "remote.origin.url"], rootDirectory);
		const branch = runCommand(["branch", "--show-current"], rootDirectory);
		const commitSha = runCommand(["rev-parse", "HEAD"], rootDirectory);
		const workingTreeStatus = runCommand(["status", "--porcelain"], rootDirectory);

		if (!branch) throw new Error("Smart Deploy cannot initialize from a detached Git HEAD.");
		if (!commitSha) throw new Error("Smart Deploy could not resolve the current Git commit.");

		return {
			rootDirectory,
			repoUrl: normalizeGitHubRemote(remote),
			branch,
			commitSha,
			isWorkingTreeClean: !workingTreeStatus,
		};
	} catch (error: unknown) {
		if (error instanceof Error && error.message.startsWith("Smart Deploy")) throw error;
		throw new Error("Smart Deploy must run inside a Git repository with an origin remote.");
	}
}
