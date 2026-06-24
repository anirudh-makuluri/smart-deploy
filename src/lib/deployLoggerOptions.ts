import type { DeployStep } from "@/app/types";

export type DeployLoggerOptions = {
	onStepsChange: (steps: DeployStep[]) => void;
	broadcast: (id: string, msg: string) => void;
};
