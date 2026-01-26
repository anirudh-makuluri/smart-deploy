import { spawn } from "child_process";

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
			const str = data.toString();
			output += str;
			process.stdout.write(str); // Live stream
		});

		child.stderr.on("data", (data) => {
			const str = data.toString();
			output += str; // ✅ Add this line to capture stderr output too
			process.stderr.write(str);
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
	opts?: { cwd?: string }
): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		const child = spawn(cmd, args, { shell: true, ...opts });

		const sendWS = (msg: string) => {
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
		};

		sendWS(`🔄 Running: ${cmd} ${args.join(" ")}`);

		child.stdout.on("data", (data) => {
			const str = data.toString();
			output += str;

			sendWS(str)
			process.stdout.write(str);
		});

		child.stderr.on("data", (data) => {
			const err = data.toString();
			sendWS(err)
			process.stderr.write(err);
		});

		child.on("exit", (code) => {
			if (code === 0) {
				sendWS(`✅ Done: ${cmd}`);
				resolve(output);
			}
			else {
				sendWS(`❌ Failed: ${cmd} ${args.join(" ")} (exit ${code})`);
				reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
			}
		});

		child.on("error", (err) => {
			sendWS(`❌ Process error: ${err.message}`);
			reject(err);
		});
	});
}