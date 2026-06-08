import type { SDRailpackPlan } from "@/app/types";

export type RailpackCommandOverrides = {
	installCmd: string;
	buildCmd: string;
	startCmd: string;
};

type RailpackCommandEntry = { cmd?: string; [key: string]: unknown };

function shellCommands(step?: { commands?: RailpackCommandEntry[] }): string[] {
	return (step?.commands ?? [])
		.map((c) => (typeof c.cmd === "string" ? c.cmd.trim() : ""))
		.filter(Boolean);
}

function findStep(plan: SDRailpackPlan, stepName: string) {
	return plan.steps?.find((s) => s.name === stepName);
}

function shellCmdIndexes(commands: RailpackCommandEntry[]): number[] {
	return commands
		.map((c, i) => (typeof c.cmd === "string" && c.cmd.trim() ? i : -1))
		.filter((i) => i >= 0);
}

function formatBuildCmd(trimmed: string, previousCmd: string): string {
	return /sh\s+-c/.test(previousCmd) ? `sh -c ${JSON.stringify(trimmed)}` : trimmed;
}

function setStepShellCommand(
	step: { commands?: RailpackCommandEntry[] },
	cmd: string | undefined,
	options?: { preserveShWrap?: boolean },
): void {
	if (cmd === undefined) return;
	const commands = step.commands ?? (step.commands = []);
	const indexes = shellCmdIndexes(commands);
	const trimmed = cmd.trim();

	if (!trimmed) {
		if (indexes.length > 0) {
			commands.splice(indexes.at(-1)!, 1);
		}
		return;
	}

	if (indexes.length === 0) {
		commands.push({ cmd: trimmed });
		return;
	}

	const idx = indexes.at(-1)!;
	const prev = typeof commands[idx].cmd === "string" ? commands[idx].cmd! : "";
	commands[idx].cmd = options?.preserveShWrap ? formatBuildCmd(trimmed, prev) : trimmed;
}

/** Read user-facing install / build / start commands from a Railpack plan. */
export function extractRailpackCommands(plan: SDRailpackPlan | null | undefined): RailpackCommandOverrides {
	if (!plan) {
		return { installCmd: "", buildCmd: "", startCmd: "" };
	}

	const installCmds = shellCommands(findStep(plan, "install"));
	const buildCmds = shellCommands(findStep(plan, "build"));
	const startCmd = plan.deploy?.startCommand?.trim() ?? "";

	return {
		installCmd: installCmds.at(-1) ?? "",
		buildCmd: buildCmds.at(-1) ?? "",
		startCmd,
	};
}

/** Patch install / build / start commands into the correct Railpack plan steps. */
export function applyRailpackCommandOverrides(
	plan: SDRailpackPlan,
	overrides: Partial<RailpackCommandOverrides>,
): SDRailpackPlan {
	const next = structuredClone(plan) as SDRailpackPlan;

	if (overrides.startCmd !== undefined) {
		const trimmed = overrides.startCmd.trim();
		next.deploy = { ...next.deploy, startCommand: trimmed || undefined };
	}

	const installStep = findStep(next, "install");
	if (installStep && overrides.installCmd !== undefined) {
		setStepShellCommand(installStep, overrides.installCmd);
	}

	const buildStep = findStep(next, "build");
	if (buildStep && overrides.buildCmd !== undefined) {
		setStepShellCommand(buildStep, overrides.buildCmd, { preserveShWrap: true });
	}

	return next;
}

export function railpackCommandOverridesDirty(
	baseline: RailpackCommandOverrides,
	draft: RailpackCommandOverrides,
): boolean {
	return (
		baseline.installCmd !== draft.installCmd ||
		baseline.buildCmd !== draft.buildCmd ||
		baseline.startCmd !== draft.startCmd
	);
}
