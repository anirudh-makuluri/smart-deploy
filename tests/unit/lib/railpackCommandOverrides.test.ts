import { describe, expect, it } from "vitest";
import {
	applyRailpackCommandOverrides,
	extractRailpackCommands,
	railpackCommandOverridesDirty,
} from "@/lib/railpackCommandOverrides";
import type { SDRailpackPlan } from "@/app/types";

const pythonPlan: SDRailpackPlan = {
	steps: [
		{
			name: "install",
			commands: [
				{ cmd: "python -m venv /app/.venv" },
				{ path: "/app/.venv/bin" },
				{ src: "requirements.txt", dest: "requirements.txt" },
				{ cmd: "pip install -r requirements.txt" },
			],
		},
		{
			name: "build",
			inputs: [{ local: true, include: ["."] }],
			secrets: ["*"],
		},
	],
	deploy: {
		startCommand: "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}",
	},
};

const nextPlan: SDRailpackPlan = {
	steps: [
		{
			name: "install",
			commands: [{ cmd: "mkdir -p /app/node_modules/.cache" }, { cmd: "npm ci" }],
		},
		{
			name: "build",
			commands: [{ cmd: "sh -c 'npm run build'", customName: "npm run build" }],
		},
	],
	deploy: { startCommand: "npm run start" },
};

describe("extractRailpackCommands", () => {
	it("extracts primary install, build, and start commands", () => {
		expect(extractRailpackCommands(pythonPlan)).toEqual({
			installCmd: "pip install -r requirements.txt",
			buildCmd: "",
			startCmd: "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}",
		});

		expect(extractRailpackCommands(nextPlan)).toEqual({
			installCmd: "npm ci",
			buildCmd: "sh -c 'npm run build'",
			startCmd: "npm run start",
		});
	});
});

describe("applyRailpackCommandOverrides", () => {
	it("updates start command on deploy", () => {
		const updated = applyRailpackCommandOverrides(pythonPlan, {
			startCmd: 'export PATH="$PWD/.render/bin:$PATH" && python app.py',
		});
		expect(updated.deploy?.startCommand).toBe('export PATH="$PWD/.render/bin:$PATH" && python app.py');
	});

	it("adds build command when build step has no shell cmd", () => {
		const buildCmd =
			'pip install -r requirements.txt && mkdir -p .render/bin && curl -sSL https://railpack.com/install.sh | sh -s -- --bin-dir "$(pwd)/.render/bin"';
		const updated = applyRailpackCommandOverrides(pythonPlan, {
			buildCmd,
			installCmd: "",
		});

		const buildStep = updated.steps?.find((s) => s.name === "build");
		expect(buildStep?.commands?.some((c) => c.cmd === buildCmd)).toBe(true);

		const installStep = updated.steps?.find((s) => s.name === "install");
		const installCmds = (installStep?.commands ?? [])
			.map((c) => c.cmd)
			.filter(Boolean);
		expect(installCmds).toEqual(["python -m venv /app/.venv"]);
	});

	it("preserves sh -c wrapping when updating build on Node plans", () => {
		const updated = applyRailpackCommandOverrides(nextPlan, {
			buildCmd: "npm run build:prod",
		});
		const buildStep = updated.steps?.find((s) => s.name === "build");
		expect(buildStep?.commands?.at(-1)?.cmd).toBe('sh -c "npm run build:prod"');
	});
});

describe("railpackCommandOverridesDirty", () => {
	it("detects draft changes", () => {
		const baseline = extractRailpackCommands(pythonPlan);
		expect(railpackCommandOverridesDirty(baseline, baseline)).toBe(false);
		expect(
			railpackCommandOverridesDirty(baseline, {
				...baseline,
				startCmd: "python app.py",
			}),
		).toBe(true);
	});
});
