import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getProjectStatePath,
	readProjectState,
	writeProjectState,
	type ProjectState,
} from "../../../packages/cli/src/state";

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "smart-deploy-cli-"));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Smart Deploy CLI project state", () => {
	it("writes and reads repository selection without secrets", async () => {
		const workdir = await temporaryDirectory();
		const state: ProjectState = {
			version: 1,
			repoUrl: "https://github.com/acme/storefront",
			branch: "main",
			serviceName: "web",
		};

		await writeProjectState(workdir, state);

		expect(await readProjectState(workdir)).toEqual(state);
		expect(getProjectStatePath(workdir)).toContain(".smartdeploy");
	});

	it("returns null when no local project selection exists", async () => {
		expect(await readProjectState(await temporaryDirectory())).toBeNull();
	});
});
