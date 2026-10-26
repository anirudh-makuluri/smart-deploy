import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";

// Official AWS download, observed version 3.3.2; fail closed if the mutable URL changes.
const archiveUrl = "https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.zip";
const expectedSha256 = "667cde09f96f4785cede4d107d8066011e5eeceb5dd4566ea8c74c0d378fe919";
const tempBase = path.resolve(tmpdir());
const directory = await mkdtemp(path.join(tempBase, "smartdeploy-dynamodb-"));
let emulator = null;
let emulatorLog = "";
try {
	const archive = path.join(directory, "dynamodb-local.zip");
	const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(60000) });
	if (!response.ok) throw new Error("DynamoDB Local download failed: " + response.status);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw new Error("DynamoDB Local archive changed; review its new version/checksum before updating the pin.");
	await writeFile(archive, bytes);
	const runtime = path.join(directory, "runtime"); await mkdir(runtime);
	const run = (command, args, cwd = runtime) => {
		const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
		if (result.status !== 0) throw new Error(command + " failed: " + (result.stderr || result.error?.message || result.stdout));
		return result.stdout;
	};
	run("jar", ["xf", archive]);
	const classpath = [path.join(runtime, "DynamoDBLocal.jar"), path.join(runtime, "DynamoDBLocal_lib", "*")].join(path.delimiter);
	const javaSource = path.resolve("tests/helpers/LoopbackDynamo.java");
	run("javac", ["-cp", classpath, "-d", runtime, javaSource]);
	console.log("Pinned DynamoDB Local version: " + run("java", ["-jar", "DynamoDBLocal.jar", "-version"]).trim());
	const reservation = createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
	const port = reservation.address().port; await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
	emulator = spawn("java", ["-Djava.library.path=" + path.join(runtime, "DynamoDBLocal_lib"), "-cp", [runtime, classpath].join(path.delimiter), "LoopbackDynamo", String(port)], { cwd: runtime, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Emulator startup timed out")), 30000);
		const receive = bytes => { emulatorLog += bytes.toString(); if (emulatorLog.includes("SMARTDEPLOY_LOOPBACK_DYNAMO_READY")) { clearTimeout(timer); resolve(); } };
		emulator.stdout.on("data", receive); emulator.stderr.on("data", receive);
		emulator.once("error", error => { clearTimeout(timer); reject(error); });
		emulator.once("exit", () => { clearTimeout(timer); reject(new Error("Emulator exited during startup")); });
	});
	const test = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.documents.config.ts", ...process.argv.slice(2)], {
		env: { ...process.env, TEST_DYNAMODB_ENDPOINT: `http://127.0.0.1:${port}` }, windowsHide: true, stdio: "inherit",
	});
	const [code] = await once(test, "exit"); process.exitCode = code === 0 ? 0 : 1;
} catch (error) {
	console.error(error.message); if (emulatorLog) console.error(emulatorLog); process.exitCode = 1;
} finally {
	if (emulator && emulator.exitCode === null && emulator.signalCode === null) {
		const stopped = once(emulator, "exit"); emulator.kill();
		const escalation = setTimeout(() => emulator.kill("SIGKILL"), 5000); escalation.unref();
		try { await stopped; } finally { clearTimeout(escalation); }
	}
	const resolved = path.resolve(directory);
	if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith("smartdeploy-dynamodb-")) throw new Error("Refusing cleanup outside the created test fixture");
	await rm(resolved, { recursive: true, force: true });
}
