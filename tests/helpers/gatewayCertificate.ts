import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gatewayWorkloadServerName, type GatewayWorkload } from "../../src/lib/gateway/upstreamTls";

/** Loopback test material only; never provisions or changes a trust store. */
export async function gatewayCertificate(workload: GatewayWorkload): Promise<{ cert: string; key: Buffer; dispose: () => Promise<void> }> {
	const directory = await mkdtemp(path.join(tmpdir(), "smartdeploy-workload-certificate-"));
	const config = path.join(directory, "openssl.cnf"); const key = path.join(directory, "key.pem"); const cert = path.join(directory, "cert.pem");
	const dispose = async () => { for (const file of [config, key, cert]) if (existsSync(file)) await unlink(file); await rmdir(directory); };
	try {
		await writeFile(config, "[req]\ndistinguished_name=dn\n[dn]\n");
		const windows = "C:/Program Files/Git/usr/bin/openssl.exe";
		const openssl = process.env.OPENSSL_PATH || (process.platform === "win32" && existsSync(windows) ? windows : "openssl");
		execFileSync(openssl, ["req", "-config", config, "-x509", "-sha256", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1", "-subj", "/CN=workload-test", "-addext", `subjectAltName=DNS:${gatewayWorkloadServerName(workload)}`, "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", key, "-out", cert], { stdio: "ignore", windowsHide: true });
		return { cert: await readFile(cert, "utf8"), key: await readFile(key), dispose };
	} catch (error) { await dispose(); throw error; }
}
