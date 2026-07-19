export type WorkerHealthDetails = {
	port: number;
	environment: string;
	version: string;
};

export function getWorkerVersion(workerVersion: string | undefined): string {
	const version = workerVersion?.trim();
	return version || "development";
}

export function createWorkerHealthPayload({ port, environment, version }: WorkerHealthDetails) {
	return {
		ok: true,
		service: "websocket",
		port,
		environment,
		version,
	};
}
