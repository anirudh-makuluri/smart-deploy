import { randomUUID } from "node:crypto";
import type { WorkloadTlsConfig } from "../../src/lib/workload-tls/config";
import { gatewayCertificate } from "./gatewayCertificate";

export async function workloadTlsFixture(appPort: number): Promise<{ config: WorkloadTlsConfig; dispose: () => Promise<void> }> {
	const workload = { bindingId: randomUUID(), environment: "published" as const, releaseId: randomUUID() };
	const material = await gatewayCertificate(workload);
	return { config: { ...workload, certificatePem: material.cert, privateKeyPem: material.key.toString(), appPort, tlsPort: 8443,
		maxConnections: 4, timeoutMs: 3000, idleMs: 1000, handshakeMs: 500, shutdownMs: 500,
		maxInboundBytes: 8 * 1024 * 1024, maxOutboundBytes: 16 * 1024 * 1024 }, dispose: material.dispose };
}
export function workloadTlsEnvironment(config: WorkloadTlsConfig): Record<string, string> {
	return { NODE_ENV: "production", SMARTDEPLOY_BINDING_ID: config.bindingId, SMARTDEPLOY_APP_ENVIRONMENT: config.environment,
		SMARTDEPLOY_RELEASE_ID: config.releaseId, SMARTDEPLOY_TLS_CERTIFICATE: config.certificatePem, SMARTDEPLOY_TLS_KEY: config.privateKeyPem,
		SMARTDEPLOY_APP_PORT: String(config.appPort), SMARTDEPLOY_TLS_PORT: String(config.tlsPort), SMARTDEPLOY_MAX_CONNECTIONS: String(config.maxConnections),
		SMARTDEPLOY_TIMEOUT_MS: String(config.timeoutMs), SMARTDEPLOY_IDLE_MS: String(config.idleMs), SMARTDEPLOY_HANDSHAKE_MS: String(config.handshakeMs),
		SMARTDEPLOY_SHUTDOWN_MS: String(config.shutdownMs), SMARTDEPLOY_MAX_INBOUND_BYTES: String(config.maxInboundBytes), SMARTDEPLOY_MAX_OUTBOUND_BYTES: String(config.maxOutboundBytes) };
}
