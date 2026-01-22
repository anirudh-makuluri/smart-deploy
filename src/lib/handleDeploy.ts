import fs from "fs";
import os from "os"
import path from "path";
import config from "../config";
import { runCommandLiveWithWebSocket } from "../server-helper";
import { DeployConfig } from "../app/types";
// import type { WebSocket as ServerWebSocket } from "ws";

function detectLanguage(appDir: string): string {
	if (fs.existsSync(path.join(appDir, "package.json"))) return "node";
	if (fs.existsSync(path.join(appDir, "requirements.txt"))) return "python";
	if (fs.existsSync(path.join(appDir, "go.mod"))) return "go";
	if (fs.existsSync(path.join(appDir, "pom.xml"))) return "java";
	if (fs.existsSync(path.join(appDir, "Cargo.toml"))) return "rust";
	return "node"; // default fallback
}


export async function handleDeploy(deployConfig: DeployConfig, token: string, ws: any): Promise<string> {
	const send = (msg: string, id: string) => {
		if (ws.readyState === ws.OPEN) {
			const object = {
				type : 'deploy_logs',
				payload : {
					id,
					msg
				}
			}
			ws.send(JSON.stringify(object));
		}
	};

	console.log("in handle deploy")

	const projectId = config.GCP_PROJECT_ID;
	const keyObject = JSON.parse(config.GCP_SERVICE_ACCOUNT_KEY);
	const keyPath = "/tmp/smartdeploy-key.json";
	fs.writeFileSync(keyPath, JSON.stringify(keyObject, null, 2));

	console.log("🔐 Authenticating with Google Cloud...")
	send("🔐 Authenticating with Google Cloud...", 'auth');
	await runCommandLiveWithWebSocket("gcloud", ["auth", "activate-service-account", `--key-file=${keyPath}`], ws, 'auth');
	await runCommandLiveWithWebSocket("gcloud", ["config", "set", "project", projectId, "--quiet"], ws, 'auth');
	await runCommandLiveWithWebSocket("gcloud", ["auth", "configure-docker"], ws, 'auth');

	const repoUrl = deployConfig.url;
	const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "default-app";
	const serviceName = `${repoName}`;

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-"));
	const cloneDir = path.join(tmpDir, repoName);

	const authenticatedRepoUrl = repoUrl.replace("https://", `https://${token}@`);
	const branch = deployConfig.branch?.trim() || "main";
	send(`📦 Cloning repo from branch "${branch}"...`, 'clone');
	await runCommandLiveWithWebSocket("git", ["clone", "-b", branch, authenticatedRepoUrl, cloneDir], ws, 'clone');

	const appDir = deployConfig.workdir ? path.join(cloneDir, deployConfig.workdir) : cloneDir;
	const dockerfilePath = path.join(appDir, "Dockerfile");

	if (deployConfig.use_custom_dockerfile && deployConfig.dockerfileContent) {
		send("✍️ Writing custom Dockerfile...", 'clone');

		fs.writeFileSync(dockerfilePath, deployConfig.dockerfileContent);
	}

	if (!deployConfig.use_custom_dockerfile && !fs.existsSync(dockerfilePath)) {
		const language = detectLanguage(appDir);
		send(`Detected Language : ${language}`, 'clone')

		let dockerfileContent = "";

		switch (language) {
			case "node":
				dockerfileContent = `
FROM node:18
WORKDIR ${deployConfig.workdir || "."}
COPY . .
RUN ${deployConfig.install_cmd || "npm install"}
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : ""}
EXPOSE 8080
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["npm", "start"])}
		`.trim();
				break;

			case "python":
				dockerfileContent = `
FROM python:3.11
WORKDIR ${deployConfig.workdir || "/app"}
COPY . .
RUN ${deployConfig.install_cmd || "pip install -r requirements.txt"}
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : ""}
EXPOSE 8080
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["python", "main.py"])}
		`.trim();
				break;

			case "go":
				dockerfileContent = `
FROM golang:1.20
WORKDIR ${deployConfig.workdir || "/app"}
COPY . .
RUN ${deployConfig.install_cmd || "go mod tidy"}
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : "RUN go build -o app"}
EXPOSE 8080
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["./app"])}
		`.trim();
				break;

			case "java":
				dockerfileContent = `
FROM openjdk:17
WORKDIR ${deployConfig.workdir || "/app"}
COPY . .
RUN ${deployConfig.install_cmd || "./mvnw install"}
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : "RUN ./mvnw package"}
EXPOSE 8080
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["java", "-jar", "target/app.jar"])}
		`.trim();
				break;

			case "rust":
				dockerfileContent = `
FROM rust:1.70
WORKDIR ${deployConfig.workdir || "/app"}
COPY . .
RUN ${deployConfig.install_cmd || "cargo fetch"}
${deployConfig.build_cmd ? `RUN ${deployConfig.build_cmd}` : "RUN cargo build --release"}
EXPOSE 8080
CMD ${JSON.stringify(deployConfig.run_cmd?.split(" ") || ["./target/release/app"])}
		`.trim();
				break;

			default:
				throw new Error("Unsupported language or missing Dockerfile.");
		}


		fs.writeFileSync(dockerfilePath, dockerfileContent);

	}

	const imageName = `${repoName}-image`;
	const gcpImage = `gcr.io/${projectId}/${imageName}:latest`;

	send("🐳 Building Docker image with Cloud Build...", 'docker');
	await runCommandLiveWithWebSocket("gcloud", [
		"builds", "submit",
		"--tag", gcpImage,
		appDir
	], ws, 'docker');

	send("🚀 Deploying to Cloud Run...", 'deploy');
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


	send(`Deployment success`, 'done')

	// ✅ Cleanup temp folder
	fs.rmSync(tmpDir, { recursive: true, force: true });


	return "done"
}
