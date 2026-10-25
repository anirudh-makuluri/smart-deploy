import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";

export interface WorkloadTlsConfig {
	bindingId: string; environment: "preview" | "published"; releaseId: string;
	certificatePem: string; privateKeyPem: string; appPort: number; tlsPort: number;
	maxConnections: number; timeoutMs: number; idleMs: number; handshakeMs: number;
	maxInboundBytes: number; maxOutboundBytes: number; shutdownMs: number;
}
export class WorkloadTlsError extends Error { constructor() { super("Workload TLS unavailable."); } }
function requireConfig(condition: unknown): asserts condition { if (!condition) throw new WorkloadTlsError(); }
function integer(value: number, min: number, max: number): void { requireConfig(Number.isSafeInteger(value) && value >= min && value <= max); }
export function workloadServerName(config: Pick<WorkloadTlsConfig, "bindingId" | "environment" | "releaseId">): string {
	const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	requireConfig(uuid.test(config.bindingId) && uuid.test(config.releaseId) && ["preview", "published"].includes(config.environment));
	return `${config.bindingId.toLowerCase()}.${config.environment}.${config.releaseId.toLowerCase()}.gateway.invalid`;
}
export function requireWorkloadCertificateCurrent(certificate: X509Certificate): void {
	const now = Date.now(); requireConfig(Date.parse(certificate.validFrom) <= now && now < Date.parse(certificate.validTo));
}
/** No platform imports or dependencies: this code ships inside the customer task. */
export function validateWorkloadTlsConfig(value: WorkloadTlsConfig): { config: WorkloadTlsConfig; certificate: X509Certificate; serverName: string } {
	try {
		const config = { ...value }; const serverName = workloadServerName(config);
		integer(config.appPort, 1, 65535); integer(config.tlsPort, 1, 65535); requireConfig(config.appPort !== config.tlsPort);
		integer(config.maxConnections, 1, 32); integer(config.timeoutMs, 1, 30000); integer(config.idleMs, 1, 5000);
		integer(config.handshakeMs, 1, 5000); integer(config.shutdownMs, 0, 5000);
		integer(config.maxInboundBytes, 1, 8 * 1024 * 1024); integer(config.maxOutboundBytes, 1, 64 * 1024 * 1024);
		requireConfig(typeof config.certificatePem === "string" && Buffer.byteLength(config.certificatePem) <= 8192
			&& typeof config.privateKeyPem === "string" && Buffer.byteLength(config.privateKeyPem) <= 8192);
		const certificate = new X509Certificate(config.certificatePem);
		requireConfig(certificate.toString().replace(/\s/g, "") === config.certificatePem.replace(/\s/g, "")
			&& certificate.subjectAltName === `DNS:${serverName}` && certificate.verify(certificate.publicKey));
		requireConfig(/^-----BEGIN (PRIVATE KEY|EC PRIVATE KEY|RSA PRIVATE KEY)-----[\r\n][A-Za-z0-9+/=\r\n]+-----END \1-----$/.test(config.privateKeyPem.trim()));
		const key = createPrivateKey(config.privateKeyPem);
		requireConfig(createPublicKey(key).equals(certificate.publicKey)); requireWorkloadCertificateCurrent(certificate);
		return { config, certificate, serverName };
	} catch { throw new WorkloadTlsError(); }
}
function numberFromEnv(environment: Readonly<Record<string, string | undefined>>, key: string): number {
	const value = environment[key]; requireConfig(value && /^(0|[1-9]\d{0,9})$/.test(value)); return Number(value);
}
function stringFromEnv(environment: Readonly<Record<string, string | undefined>>, key: string): string {
	const value = environment[key]; requireConfig(value); return value;
}
export function workloadTlsConfigFromEnv(environment: Readonly<Record<string, string | undefined>>): WorkloadTlsConfig {
	const appEnvironment = stringFromEnv(environment, "SMARTDEPLOY_APP_ENVIRONMENT");
	requireConfig(appEnvironment === "preview" || appEnvironment === "published");
	return validateWorkloadTlsConfig({
		bindingId: stringFromEnv(environment, "SMARTDEPLOY_BINDING_ID"), environment: appEnvironment,
		releaseId: stringFromEnv(environment, "SMARTDEPLOY_RELEASE_ID"), certificatePem: stringFromEnv(environment, "SMARTDEPLOY_TLS_CERTIFICATE"),
		privateKeyPem: stringFromEnv(environment, "SMARTDEPLOY_TLS_KEY"), appPort: numberFromEnv(environment, "SMARTDEPLOY_APP_PORT"),
		tlsPort: numberFromEnv(environment, "SMARTDEPLOY_TLS_PORT"), maxConnections: numberFromEnv(environment, "SMARTDEPLOY_MAX_CONNECTIONS"),
		timeoutMs: numberFromEnv(environment, "SMARTDEPLOY_TIMEOUT_MS"), idleMs: numberFromEnv(environment, "SMARTDEPLOY_IDLE_MS"),
		handshakeMs: numberFromEnv(environment, "SMARTDEPLOY_HANDSHAKE_MS"), shutdownMs: numberFromEnv(environment, "SMARTDEPLOY_SHUTDOWN_MS"),
		maxInboundBytes: numberFromEnv(environment, "SMARTDEPLOY_MAX_INBOUND_BYTES"), maxOutboundBytes: numberFromEnv(environment, "SMARTDEPLOY_MAX_OUTBOUND_BYTES"),
	}).config;
}
