import fs from "fs";
import path from "path";
import config from "../config";
import { runCommandLiveWithWebSocket } from "../server-helper";
import { DeployConfig } from "../app/types";
// import type { WebSocket as ServerWebSocket } from "ws";

export async function handleDeploy(deployConfig: DeployConfig, token: string, ws: any): Promise<string> {
	const send = (msg: string) => {
		if (ws.readyState === ws.OPEN) ws.send(msg);
	};

	console.log("in handle deploy")

	const projectId = config.GCP_PROJECT_ID;
	const keyObject = JSON.parse(config.GCP_SERVICE_ACCOUNT_KEY);
	const keyPath = "/tmp/smartdeploy-key.json";
	fs.writeFileSync(keyPath, JSON.stringify(keyObject, null, 2));

	console.log("🔐 Authenticating with Google Cloud...")
	send("[auth] 🔐 Authenticating with Google Cloud...");
	await runCommandLiveWithWebSocket("gcloud", ["auth", "activate-service-account", `--key-file=${keyPath}`], ws, 'auth');
	await runCommandLiveWithWebSocket("gcloud", ["config", "set", "project", projectId, "--quiet"], ws, 'auth');
	await runCommandLiveWithWebSocket("gcloud", ["auth", "configure-docker"], ws, 'auth');

	const repoUrl = deployConfig.url;
	const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "default-app";
	const serviceName = `${repoName}`;
	const cloneDir = path.join(process.cwd(), "clones", repoName);

	if (fs.existsSync(cloneDir)) fs.rmSync(cloneDir, { recursive: true, force: true });
	fs.mkdirSync(cloneDir, { recursive: true });

	const authenticatedRepoUrl = repoUrl.replace("https://", `https://${token}@`);
	send("[clone] 📦 Cloning repo...");
	await runCommandLiveWithWebSocket("git", ["clone", authenticatedRepoUrl, cloneDir], ws, 'clone');

	const appDir = deployConfig.workdir ? path.join(cloneDir, deployConfig.workdir) : cloneDir;
	const dockerfilePath = path.join(appDir, "Dockerfile");

	if (!deployConfig.use_custom_dockerfile && !fs.existsSync(dockerfilePath)) {
		fs.writeFileSync(dockerfilePath, `
FROM node:18
WORKDIR ${deployConfig.workdir}
COPY . .
RUN npm install
RUN ${deployConfig.build_cmd}
EXPOSE 8080
CMD ${JSON.stringify(deployConfig.run_cmd.split(" "))}
		`.trim());
	}

	const imageName = `${repoName}-image`;
	const gcpImage = `gcr.io/${projectId}/${imageName}:latest`;

	send("[docker] 🐳 Building Docker image...");
	await runCommandLiveWithWebSocket("docker", ["build", "-t", imageName, appDir], ws), 'docker';
	await runCommandLiveWithWebSocket("docker", ["tag", imageName, gcpImage], ws, 'docker');
	await runCommandLiveWithWebSocket("docker", ["push", gcpImage], ws, 'push');

	send("[deploy] 🚀 Deploying to Cloud Run...");
	const envArgs = deployConfig.env_vars ? ["--set-env-vars", deployConfig.env_vars] : [];
	await runCommandLiveWithWebSocket("gcloud", [
		"run", "deploy", serviceName,
		"--image", gcpImage,
		"--platform", "managed",
		"--region", "us-central1",
		"--allow-unauthenticated",
		...envArgs
	], ws, 'deploy');

	await runCommandLiveWithWebSocket("gcloud", [
		"beta", "run", "services", "add-iam-policy-binding",
		serviceName,
		"--region=us-central1",
		"--platform=managed",
		"--member=allUsers",
		"--role=roles/run.invoker",
	], ws, 'deploy');

	
	send(`[done] Deployment success`)


	return "done"
}
