import { execFile } from "node:child_process";
import { promisify } from "node:util";

export default async function prepareAppLogin() {
	if (process.env.RUN_APP_LOGIN_BROWSER_TESTS !== "1") throw new Error("Explicit disposable app-login test opt-in required.");
	await import("./prepare-auth-schema.mjs");
	// Exercise compiled production routing and hydration without development HMR.
	const build = await promisify(execFile)(process.execPath, ["node_modules/next/dist/bin/next", "build"], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
	process.stdout.write(build.stdout); process.stderr.write(build.stderr);
}
