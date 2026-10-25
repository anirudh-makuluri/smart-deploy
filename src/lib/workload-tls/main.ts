import { workloadTlsConfigFromEnv } from "./config";
import { createWorkloadTlsListener, type WorkloadTlsListener } from "./tunnel";

async function main(): Promise<void> {
	let listener: WorkloadTlsListener | null = null;
	try {
		const config = workloadTlsConfigFromEnv(process.env); const active = createWorkloadTlsListener(config); listener = active;
		await new Promise<void>((resolve, reject) => {
			active.server.once("error", reject);
			active.server.once("listening", () => { active.server.removeListener("error", reject); resolve(); });
			active.server.listen({ host: "0.0.0.0", port: config.tlsPort });
		});
		const stop = () => { void active.stop(config.shutdownMs).catch(() => { process.exitCode = 1; }); };
		process.once("SIGTERM", stop); process.once("SIGINT", stop);
		active.server.on("error", () => { process.stderr.write("Workload TLS unavailable.\n"); process.exitCode = 1; stop(); });
	} catch {
		process.stderr.write("Workload TLS unavailable.\n"); process.exitCode = 1; await listener?.stop(0);
	}
}
void main();
