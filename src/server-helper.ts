import { spawn } from "child_process";

/**
 * On Windows, the terminal often uses a codec that can't display Unicode (e.g. ✓).
 * Sanitize so process.stdout.write doesn't throw 'charmap' codec errors.
 */
function safeForWindowsConsole(str: string): string {
	if (process.platform !== "win32") return str;
	// Replace common Unicode symbols with ASCII equivalents; strip other non-ASCII
	return str
		.replace(/\u2713/g, "[OK]")
		.replace(/\u2714/g, "[OK]")
		.replace(/\u274C/g, "[X]")
		.replace(/\u26A0/g, "[!]")
		.replace(/[^\x00-\x7F]/g, "?");
}

export async function runCommandLive(cmd: string, args: string[]) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: "inherit", shell: true });

		child.on("exit", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
		});
	});
}

export async function runCommandLiveWithOutput(cmd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		const child = spawn(cmd, args, { shell: true });

		child.stdout.on("data", (data) => {
			const str = data.toString('utf8');
			output += str;
			process.stdout.write(safeForWindowsConsole(str)); // Live stream
		});

		child.stderr.on("data", (data) => {
			const str = data.toString('utf8');
			output += str;
			process.stderr.write(safeForWindowsConsole(str));
		});

		child.on("exit", (code) => {
			if (code === 0) {
				resolve(output);
			} else {
				reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}\n${output}`));
			}
		});
	});
}


export async function runCommandLiveWithWebSocket(
	cmd: string,
	args: string[],
	ws?: WebSocket,
	id?: string,
	opts?: { cwd?: string; env?: NodeJS.ProcessEnv; send?: (msg: string, stepId: string) => void }
): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		// Create isolated environment - don't inherit parent NODE_PATH or other module resolution paths
		const isolatedEnv = {
			...process.env,
			...opts?.env,
			// Clear NODE_PATH to prevent module resolution from parent directories
			NODE_PATH: undefined,
			// Ensure we use the cwd's node_modules
			...(opts?.cwd && {
				// Set PWD to ensure relative paths resolve correctly
				PWD: opts.cwd
			})
		};
		const child = spawn(cmd, args, { 
			shell: true, 
			cwd: opts?.cwd,
			env: isolatedEnv
		});

		const sendWS = (msg: string) => {
			// Send to console via WebSocket and/or send function
			if (ws && ws.readyState === ws.OPEN) {
				const object = {
					type: 'deploy_logs',
					payload: {
						id,
						msg
					}
				}
				ws.send(JSON.stringify(object));
			}
			// Also send through the send function if provided (for deploySteps tracking)
			if (opts?.send && id) {
				opts.send(msg, id);
			}
		};

		sendWS(`🔄 Running: ${cmd} ${args.join(" ")}`);

		child.stdout.on("data", (data) => {
			// Use UTF-8 encoding explicitly to handle Unicode characters
			const str = data.toString('utf8');
			output += str;
			sendWS(str);
			// On Windows, writing Unicode to the terminal can cause charmap errors
			process.stdout.write(safeForWindowsConsole(str));
		});

		child.stderr.on("data", (data) => {
			const err = data.toString('utf8');
			sendWS(err);
			process.stderr.write(safeForWindowsConsole(err));
		});

		child.on("exit", (code) => {
			if (code === 0) {
				sendWS(`Done: ${cmd}`);
				resolve(output);
			}
			else {
				sendWS(`Failed: ${cmd} ${args.join(" ")} (exit ${code})`);
				reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
			}
		});

		child.on("error", (err) => {
			sendWS(`❌ Process error: ${err.message}`);
			reject(err);
		});
	});
}