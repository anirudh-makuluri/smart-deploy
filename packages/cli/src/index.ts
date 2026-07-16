#!/usr/bin/env node

import { cwd, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { normalizeGitHubRemote, readGitRepositoryContext } from "./git.js";
import { readProjectState, writeProjectState, type ProjectState } from "./state.js";
import { login, logout } from "./auth.js";

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
  smart-deploy repo show
  smart-deploy repo use URL [--branch NAME]
  smart-deploy service select NAME
  smart-deploy config show

The current foundation stores only repository, branch, and service selection locally. Analysis, domain, secrets, and deployment commands follow in the next slice.`);
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

async function main(): Promise<void> {
	const { positionals, options } = parseArguments(process.argv.slice(2));
	const [command, subcommand] = positionals;
	if (!command || command === "help" || command === "--help") return printHelp();
	if (command === "login") return login();
	if (command === "logout") return logout();
	if (command === "init") return initialize(options);
	if (command === "config" && subcommand === "show") return showConfig();
	if (command === "repo" && subcommand === "show") return showConfig();
	if (command === "repo" && subcommand === "use") return selectRepository(positionals, options);
	if (command === "service" && subcommand === "select") return selectService(positionals);
	throw new Error(`Unknown command: ${positionals.join(" ")}`);
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : "Smart Deploy command failed.");
	process.exitCode = 1;
});
