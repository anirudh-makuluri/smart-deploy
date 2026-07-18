import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PROJECT_STATE_DIRECTORY = ".smartdeploy";
export const PROJECT_STATE_FILE = "state.json";

export type ProjectState = {
	version: 1;
	repoUrl: string;
	branch: string;
	serviceName: string | null;
};

function asNonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseProjectState(value: unknown): ProjectState {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Smart Deploy state must be an object.");
	}

	const state = value as Record<string, unknown>;
	const repoUrl = asNonEmptyString(state.repoUrl);
	const branch = asNonEmptyString(state.branch);
	const serviceName = state.serviceName === null ? null : asNonEmptyString(state.serviceName);

	if (state.version !== 1 || !repoUrl || !branch || (state.serviceName !== null && !serviceName)) {
		throw new Error("Smart Deploy state is invalid. Run `smart-deploy init` again.");
	}

	return { version: 1, repoUrl, branch, serviceName };
}

export function getProjectStatePath(workdir: string): string {
	return join(workdir, PROJECT_STATE_DIRECTORY, PROJECT_STATE_FILE);
}

export async function readProjectState(workdir: string): Promise<ProjectState | null> {
	const statePath = getProjectStatePath(workdir);
	try {
		const content = await readFile(statePath, "utf8");
		return parseProjectState(JSON.parse(content) as unknown);
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		if (error instanceof SyntaxError) {
			throw new Error("Smart Deploy state is not valid JSON. Run `smart-deploy init` again.");
		}
		throw error;
	}
}

export async function writeProjectState(workdir: string, state: ProjectState): Promise<void> {
	const directory = join(workdir, PROJECT_STATE_DIRECTORY);
	const statePath = getProjectStatePath(workdir);
	const temporaryPath = `${statePath}.${process.pid}.tmp`;

	await mkdir(directory, { recursive: true, mode: 0o700 });
	await writeFile(temporaryPath, `${JSON.stringify(parseProjectState(state), null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await rename(temporaryPath, statePath);
}
