import { createPrivateKey, X509Certificate } from "node:crypto";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { PoolConfig } from "pg";
import { z } from "zod";
import { ManagedGatewayError, ManagedGatewayOptions } from "./managedRouteSchema";
import { ManagedRouterTiming } from "./managedRouter";

export const GatewayServerConfig = z.strictObject({ gateway: ManagedGatewayOptions, timing: ManagedRouterTiming,
	address: z.enum(["127.0.0.1", "0.0.0.0"]), port: z.number().int().min(1024).max(65535),
	tlsKeyFile: z.string().min(1), tlsCertificateFile: z.string().min(1), databaseCaFile: z.string().min(1),
});
export type GatewayServerConfig = z.infer<typeof GatewayServerConfig>;

/** Bounded local operator files only; never read a customer supplied file path. */
export async function gatewayFile(path: string, maximum: number): Promise<Buffer> {
	if (!isAbsolute(path)) throw new ManagedGatewayError();
	const file = await open(path, "r");
	try {
		if (!(await file.stat()).isFile()) throw new ManagedGatewayError();
		const buffer = Buffer.alloc(maximum + 1); let size = 0;
		while (size < buffer.length) {
			const part = await file.read(buffer, size, buffer.length - size, null); if (!part.bytesRead) break; size += part.bytesRead;
		}
		if (!size || size > maximum) throw new ManagedGatewayError(); return buffer.subarray(0, size);
	} finally { await file.close(); }
}

export function gatewayDatabaseOptions(connectionString: string, ca: string): PoolConfig {
	try {
		const url = new URL(connectionString);
		if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.pathname || url.pathname === "/") throw new Error();
		new X509Certificate(ca);
		// pg's URL SSL options otherwise replace the explicit verified TLS object.
		for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith("ssl") || key === "uselibpqcompat") url.searchParams.delete(key);
		return { connectionString: url.href, ssl: { ca, rejectUnauthorized: true, minVersion: "TLSv1.2" }, max: 2,
			connectionTimeoutMillis: 1500, query_timeout: 2200, statement_timeout: 2000, idleTimeoutMillis: 3000,
			application_name: "smartdeploy-private-gateway", allowExitOnIdle: true };
	} catch { throw new ManagedGatewayError(); }
}

export async function gatewayServerFiles(configPath: string): Promise<{ settings: GatewayServerConfig; key: Buffer; cert: Buffer; databaseCa: string }> {
	try {
		const settings = GatewayServerConfig.parse(JSON.parse((await gatewayFile(configPath, 16384)).toString("utf8")));
		const [key, cert, databaseBytes] = await Promise.all([gatewayFile(settings.tlsKeyFile, 16384),
			gatewayFile(settings.tlsCertificateFile, 16384), gatewayFile(settings.databaseCaFile, 65536)]);
		const databaseCa = databaseBytes.toString("utf8");
		const certificate = new X509Certificate(cert);
		if (!certificate.checkPrivateKey(createPrivateKey(key)) || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw new Error();
		new X509Certificate(databaseCa);
		return { settings, key, cert, databaseCa };
	} catch { throw new ManagedGatewayError(); }
}
