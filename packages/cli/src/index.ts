#!/usr/bin/env node

import { cwd, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { normalizeGitHubRemote, readGitRepositoryContext } from "./git.js";
import { readProjectState, writeProjectState, type ProjectState } from "./state.js";
import { login, logout } from "./auth.js";
import { graphql, platformFetch, platformJson } from "./platform.js";

type ParsedArguments = {
	positionals: string[];
	options: Map<string, string>;
};

function parseArguments(args: string[]): ParsedArguments {
	const positionals: string[] = [];
	const options = new Map<string, string>();
	for (let index = 0; index < args.length; index += 1) {
		const current = args[index];
		if (!current.startsWith("--")) {
			positionals.push(current);
			continue;
		}
		const [name, inlineValue] = current.slice(2).split("=", 2);
		if (name === "follow" || name === "help") {
			options.set(name, "true");
			continue;
		}
		const nextValue = inlineValue ?? args[index + 1];
		if (!name || !nextValue || nextValue.startsWith("--")) {
			throw new Error(`Option --${name || current} requires a value.`);
		}
		options.set(name, nextValue);
		if (inlineValue === undefined) index += 1;
	}
	return { positionals, options };
}

async function ask(question: string, defaultValue: string): Promise<string> {
	const prompt = createInterface({ input: stdin, output: stdout });
	try {
		const answer = (await prompt.question(`${question} [${defaultValue}]: `)).trim();
		return answer || defaultValue;
	} finally {
		prompt.close();
	}
}

function printHelp(): void {
	console.log(`Smart Deploy CLI

Usage:
  smart-deploy init [--repo URL] [--branch NAME] [--service NAME]
  smart-deploy login | logout
  smart-deploy repo list | show | use URL [--branch NAME]
  smart-deploy service discover | list | select NAME
  smart-deploy analyze
  smart-deploy env list | set NAME VALUE | unset NAME
  smart-deploy domain check SUBDOMAIN | set URL | clear
  smart-deploy deploy [--commit SHA]
  smart-deploy deployment delete
  smart-deploy status
  smart-deploy logs [--run ID] [--follow]
  smart-deploy rollback RUN_ID
  smart-deploy config show

Smart Deploy stores the repository, branch, and selected service locally. Platform operations use your CLI login and execute against the selected GitHub repository.`);
}

async function initialize(options: Map<string, string>): Promise<void> {
	const context = readGitRepositoryContext(cwd());
	const repoUrl = normalizeGitHubRemote(options.get("repo") ?? await ask("Repository URL", context.repoUrl));
	const branch = options.get("branch") ?? await ask("Branch", context.branch);
	const serviceName = options.get("service") ?? null;
	const state: ProjectState = { version: 1, repoUrl, branch, serviceName };
	await writeProjectState(context.rootDirectory, state);
	console.log(`Saved Smart Deploy project selection in ${context.rootDirectory}\\.smartdeploy\\state.json`);
	console.log(`Repository: ${repoUrl}\nBranch: ${branch}\nService: ${serviceName ?? "not selected"}`);
	if (!context.isWorkingTreeClean) {
		console.log("\nNote: your working tree has uncommitted changes. Analysis and deploy will require a pushed commit.");
	}
}

async function showConfig(): Promise<void> {
	const context = readGitRepositoryContext(cwd());
	const state = await readProjectState(context.rootDirectory);
	if (!state) throw new Error("No Smart Deploy project selection found. Run smart-deploy init first.");
	console.log(JSON.stringify(state, null, 2));
}

async function selectRepository(positionals: string[], options: Map<string, string>): Promise<void> {
	const repoUrlInput = positionals[2]?.trim();
	if (!repoUrlInput) throw new Error("Usage: smart-deploy repo use <repository-url> [--branch NAME]");
	const repoUrl = normalizeGitHubRemote(repoUrlInput);
	const context = readGitRepositoryContext(cwd());
	const current = await readProjectState(context.rootDirectory);
	const branch = options.get("branch") ?? current?.branch ?? context.branch;
	await writeProjectState(context.rootDirectory, { version: 1, repoUrl, branch, serviceName: null });
	console.log(`Selected repository ${repoUrl} on ${branch}. Choose a service with smart-deploy service select <name>.`);
}

async function selectService(positionals: string[]): Promise<void> {
	const serviceName = positionals[2]?.trim();
	if (!serviceName) throw new Error("Usage: smart-deploy service select <name>");
	const context = readGitRepositoryContext(cwd());
	const current = await readProjectState(context.rootDirectory);
	if (!current) throw new Error("No Smart Deploy project selection found. Run smart-deploy init first.");
	await writeProjectState(context.rootDirectory, { ...current, serviceName });
	console.log(`Selected service ${serviceName}.`);
}

type SelectedProject = { rootDirectory: string; state: ProjectState; repoName: string };
type Service = { name: string; path: string; language: string; framework?: string | null; port?: number | null };
type RepoRecord = { repo_url: string; repo_name: string; branch: string; services: Service[] };
type Deployment = Record<string, unknown> & { repoName: string; serviceName: string; branch: string; scanResults: Record<string, unknown>; commitSha?: string | null };
type HistoryEntry = { id: string; commitSha?: string | null; success: boolean; timestamp: string };

function repoNameFromUrl(repoUrl: string): string {
	const parts = repoUrl.replace(/\/+$/, "").split("/");
	const repoName = parts.at(-1)?.replace(/\.git$/i, "") ?? "";
	if (!repoName) throw new Error("Could not determine the repository name.");
	return repoName;
}

async function selectedProject(): Promise<SelectedProject> {
	const context = readGitRepositoryContext(cwd());
	const state = await readProjectState(context.rootDirectory);
	if (!state) throw new Error("No Smart Deploy project selection found. Run smart-deploy init first.");
	return { rootDirectory: context.rootDirectory, state, repoName: repoNameFromUrl(state.repoUrl) };
}

async function repoRecords(): Promise<RepoRecord[]> {
	const data = await graphql<{ repoRecords: RepoRecord[] }>(`
		query CliRepoRecords { repoRecords { repo_url repo_name branch services { name path language framework port } } }
	`);
	return data.repoRecords;
}

async function selectedRecord(project: SelectedProject): Promise<RepoRecord> {
	const record = (await repoRecords()).find((candidate) => candidate.repo_url.toLowerCase() === project.state.repoUrl.toLowerCase());
	if (!record) throw new Error("No discovered services for this repository. Run smart-deploy service discover first.");
	return record;
}

async function selectedDeployment(project: SelectedProject): Promise<Deployment> {
	if (!project.state.serviceName) throw new Error("No service selected. Run smart-deploy service select <name> first.");
	const data = await graphql<{ repoDeployments: Deployment[] }>(`
		query CliDeployments($repoName: String!) {
			repoDeployments(repoName: $repoName) {
				id repoName repoUrl branch responseId commitSha hostedSubdomain hostedUrl screenshotUrl serviceName status
				firstDeployment lastDeployment revision cloudProvider deploymentTarget region secretsArn cloudResources scanResults
			}
		}
	`, { repoName: project.repoName });
	const deployment = data.repoDeployments.find((candidate) => candidate.serviceName === project.state.serviceName);
	if (!deployment) throw new Error("No deployment configuration found. Run smart-deploy analyze first.");
	return deployment;
}

function printJson(value: unknown): void {
	console.log(JSON.stringify(value, null, 2));
}

async function listRepositories(): Promise<void> {
	const data = await graphql<{ refreshRepos: { repoList: Array<{ full_name: string; html_url: string; default_branch: string; private: boolean }> } }>(`
		mutation CliRefreshRepos { refreshRepos { repoList { full_name html_url default_branch private } } }
	`);
	for (const repo of data.refreshRepos.repoList) {
		console.log(`${repo.full_name}\t${repo.default_branch}\t${repo.private ? "private" : "public"}\t${repo.html_url}`);
	}
}

async function discoverServices(): Promise<void> {
	const project = await selectedProject();
	const data = await graphql<{ detectServices: { services: Service[]; isMonorepo: boolean; isMultiService: boolean } }>(`
		mutation CliDetectServices($url: String!, $branch: String) {
			detectServices(url: $url, branch: $branch) {
				isMonorepo isMultiService services { name path language framework port }
			}
		}
	`, { url: project.state.repoUrl, branch: project.state.branch });
	printJson(data.detectServices);
}

async function listServices(): Promise<void> {
	const project = await selectedProject();
	const record = await selectedRecord(project);
	for (const service of record.services) {
		console.log(`${service.name}\t${service.path}\t${service.framework ?? service.language}`);
	}
}

function parseSseMessage(message: string): { event: string; data: unknown } | null {
	let event = "message";
	const dataLines: string[] = [];
	for (const line of message.split(/\r?\n/)) {
		if (line.startsWith("event:")) event = line.slice(6).trim();
		if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
	}
	if (dataLines.length === 0) return null;
	try {
		return { event, data: JSON.parse(dataLines.join("\n")) as unknown };
	} catch {
		throw new Error(`Could not parse ${event} event from Smart Analysis.`);
	}
}

async function runAnalysis(): Promise<void> {
	const project = await selectedProject();
	if (!project.state.serviceName) throw new Error("No service selected. Run smart-deploy service select <name> first.");
	const record = await selectedRecord(project);
	const service = record.services.find((candidate) => candidate.name === project.state.serviceName);
	if (!service) throw new Error("Selected service is not in the discovered catalog. Run smart-deploy service discover.");
	const ownerAndRepo = project.state.repoUrl.match(/github\.com\/([^/]+)\/([^/]+)$/i);
	if (!ownerAndRepo) throw new Error("Selected repository is not a GitHub repository.");
	const commitResult = await graphql<{ latestCommit: { sha: string } }>(`
		query CliLatestCommit($owner: String!, $repo: String!, $branch: String) {
			latestCommit(owner: $owner, repo: $repo, branch: $branch) { sha }
		}
	`, { owner: ownerAndRepo[1], repo: ownerAndRepo[2], branch: project.state.branch });

	const response = await platformFetch("/api/scan/stream", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ repo_url: project.state.repoUrl, package_path: service.path, commit_sha: commitResult.latestCommit.sha }),
	});
	if (!response.ok || !response.body) {
		throw new Error((await response.text()) || `Failed to start Smart Analysis (${response.status}).`);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let scanResults: Record<string, unknown> | null = null;
	for (;;) {
		const { done, value } = await reader.read();
		buffer += decoder.decode(value, { stream: !done });
		const messages = buffer.split("\n\n");
		buffer = messages.pop() ?? "";
		for (const message of messages) {
			const parsed = parseSseMessage(message);
			if (!parsed) continue;
			if (parsed.event === "progress") printJson(parsed.data);
			if (parsed.event === "error") throw new Error(JSON.stringify(parsed.data));
			if (parsed.event === "complete" && parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)) {
				scanResults = parsed.data as Record<string, unknown>;
			}
		}
		if (done) break;
	}
	if (!scanResults || !Array.isArray(scanResults.deploy_units)) throw new Error("Smart Analysis completed without a deploy plan.");
	const responseId = typeof scanResults.response_id === "string" ? scanResults.response_id : null;
	await platformJson("/api/deployments/analysis", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			repoName: project.repoName,
			serviceName: project.state.serviceName,
			repoUrl: project.state.repoUrl,
			branch: project.state.branch,
			commitSha: commitResult.latestCommit.sha,
			responseId,
			scanResults,
		}),
	});
	printJson(scanResults);
}

async function environment(positionals: string[]): Promise<void> {
	const project = await selectedProject();
	if (!project.state.serviceName) throw new Error("No service selected. Run smart-deploy service select <name> first.");
	const action = positionals[1];
	const current = await platformJson<{ entries: Array<{ name: string; value: string }> }>(
		`/api/deployments/env-secrets?${new URLSearchParams({ repoName: project.repoName, serviceName: project.state.serviceName }).toString()}`
	);
	if (action === "list") {
		for (const entry of current.entries) console.log(entry.name);
		return;
	}
	const name = positionals[2]?.trim();
	if (!name || (action !== "set" && action !== "unset")) throw new Error("Usage: smart-deploy env list | set NAME VALUE | unset NAME");
	const value = positionals[3];
	if (action === "set" && value === undefined) throw new Error("Usage: smart-deploy env set NAME VALUE");
	const entries = current.entries.filter((entry) => entry.name !== name);
	if (action === "set") entries.push({ name, value });
	const result = await platformJson<{ secretsArn: string; entryCount: number }>("/api/deployments/env-secrets", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ repoName: project.repoName, serviceName: project.state.serviceName, entries }),
	});
	console.log(`Saved ${result.entryCount} environment variable(s).`);
}

async function domain(positionals: string[]): Promise<void> {
	const project = await selectedProject();
	if (!project.state.serviceName) throw new Error("No service selected. Run smart-deploy service select <name> first.");
	const action = positionals[1];
	if (action === "check") {
		const subdomain = positionals[2]?.trim();
		if (!subdomain) throw new Error("Usage: smart-deploy domain check SUBDOMAIN");
		const data = await graphql<{ verifyDns: unknown }>(`mutation CliVerifyDns($subdomain: String!, $repoName: String!, $serviceName: String!) { verifyDns(subdomain: $subdomain, repoName: $repoName, serviceName: $serviceName) { available isOwned subdomain customUrl alternatives message } }`, { subdomain, repoName: project.repoName, serviceName: project.state.serviceName });
		return printJson(data.verifyDns);
	}
	if (action !== "set" && action !== "clear") throw new Error("Usage: smart-deploy domain check SUBDOMAIN | set URL | clear");
	const customUrl = action === "set" ? positionals[2]?.trim() : "";
	if (action === "set" && !customUrl) throw new Error("Usage: smart-deploy domain set URL");
	const data = await graphql<{ updateCustomDomain: { message?: string | null; customUrl?: string | null } }>(`mutation CliUpdateDomain($repoName: String!, $serviceName: String!, $customUrl: String) { updateCustomDomain(repoName: $repoName, serviceName: $serviceName, customUrl: $customUrl) { message customUrl } }`, { repoName: project.repoName, serviceName: project.state.serviceName, customUrl });
	console.log(data.updateCustomDomain.message ?? "Domain updated.");
}

async function queueDeployment(commitSha: string | undefined): Promise<void> {
	const project = await selectedProject();
	const deployment = await selectedDeployment(project);
	const config: Deployment = { ...deployment, ...(commitSha ? { commitSha } : {}) };
	const result = await platformJson<{ runId: string; status: string }>("/api/cli/deployments/queue", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ config }),
	});
	console.log(`Deployment ${result.status}: ${result.runId}`);
}

async function deleteSelectedDeployment(): Promise<void> {
	const project = await selectedProject();
	if (!project.state.serviceName) throw new Error("No service selected. Run smart-deploy service select <name> first.");
	const data = await graphql<{ deleteDeployment: { message?: string | null } }>(
		`mutation CliDeleteDeployment($payload: DeleteDeploymentInput!) {
			deleteDeployment(payload: $payload) { message }
		}`,
		{ payload: { repoName: project.repoName, serviceName: project.state.serviceName } }
	);
	console.log(data.deleteDeployment.message ?? "Deployment deleted.");
}

async function status(): Promise<void> {
	const project = await selectedProject();
	printJson(await selectedDeployment(project));
}

async function logs(options: Map<string, string>): Promise<void> {
	const project = await selectedProject();
	const runId = options.get("run");
	if (runId) {
		const printedLogCounts = new Map<string, number>();
		const printRunLogs = async (): Promise<boolean> => {
			const result = await platformJson<{ steps: Array<{ label: string; logs: string[]; status: string }>; completed: boolean }>(`/api/deployment-runs/${encodeURIComponent(runId)}/logs`);
			for (const step of result.steps) {
				const previousCount = printedLogCounts.get(step.label) ?? 0;
				for (const line of step.logs.slice(previousCount)) console.log(`[${step.label}] ${line}`);
				printedLogCounts.set(step.label, step.logs.length);
			}
			return result.completed;
		};
		const completed = await printRunLogs();
		if (options.has("follow")) {
			let done = completed;
			while (!done) {
				await new Promise((resolve) => setTimeout(resolve, 2000));
				done = await printRunLogs();
			}
		}
		return;
	}
	if (!project.state.serviceName) throw new Error("No service selected. Run smart-deploy service select <name> first.");
	const data = await graphql<{ serviceLogs: { logs: Array<{ timestamp?: string | null; message?: string | null }> } }>(`query CliServiceLogs($repoName: String!, $serviceName: String!) { serviceLogs(repoName: $repoName, serviceName: $serviceName, limit: 200) { logs { timestamp message } } }`, { repoName: project.repoName, serviceName: project.state.serviceName });
	for (const entry of data.serviceLogs.logs) console.log(`${entry.timestamp ?? ""}\t${entry.message ?? ""}`.trim());
}

async function rollback(runId: string | undefined): Promise<void> {
	if (!runId) throw new Error("Usage: smart-deploy rollback RUN_ID");
	const project = await selectedProject();
	if (!project.state.serviceName) throw new Error("No service selected. Run smart-deploy service select <name> first.");
	const data = await graphql<{ deploymentHistory: { history: HistoryEntry[] } }>(`query CliDeploymentHistory($repoName: String!, $serviceName: String!) { deploymentHistory(repoName: $repoName, serviceName: $serviceName, page: 1, limit: 100) { history { id commitSha success timestamp } } }`, { repoName: project.repoName, serviceName: project.state.serviceName });
	const entry = data.deploymentHistory.history.find((candidate) => candidate.id === runId && candidate.success);
	if (!entry?.commitSha) throw new Error("Rollback requires a successful deployment run with a commit SHA.");
	await queueDeployment(entry.commitSha);
}

async function main(): Promise<void> {
	const { positionals, options } = parseArguments(process.argv.slice(2));
	const [command, subcommand] = positionals;
	if (!command || command === "help" || command === "--help") return printHelp();
	if (command === "login") return login();
	if (command === "logout") return logout();
	if (command === "init") return initialize(options);
	if (command === "config" && subcommand === "show") return showConfig();
	if (command === "repo" && subcommand === "list") return listRepositories();
	if (command === "repo" && subcommand === "show") return showConfig();
	if (command === "repo" && subcommand === "use") return selectRepository(positionals, options);
	if (command === "service" && subcommand === "discover") return discoverServices();
	if (command === "service" && subcommand === "list") return listServices();
	if (command === "service" && subcommand === "select") return selectService(positionals);
	if (command === "analyze") return runAnalysis();
	if (command === "env") return environment(positionals);
	if (command === "domain") return domain(positionals);
	if (command === "deploy") return queueDeployment(options.get("commit"));
	if (command === "deployment" && subcommand === "delete") return deleteSelectedDeployment();
	if (command === "status") return status();
	if (command === "logs") return logs(options);
	if (command === "rollback") return rollback(positionals[1]);
	throw new Error(`Unknown command: ${positionals.join(" ")}`);
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : "Smart Deploy command failed.");
	process.exitCode = 1;
});
