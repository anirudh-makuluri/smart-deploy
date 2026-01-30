import fs from "fs";
import os from "os";
import path from "path";
import archiver from "archiver";
import config from "../../config";
import { DeployConfig } from "../../app/types";
import { runCommandLiveWithWebSocket } from "../../server-helper";
import {
	setupAWSCredentials,
	runAWSCommand,
	generateResourceName,
} from "./awsHelpers";

/** Amplify app name must be 1–255 chars; branch name 1–255, pattern (?s).+ */
function sanitizeBranchName(branch: string): string {
	return branch.trim().replace(/\//g, "-").slice(0, 255) || "main";
}

/**
 * Detects the build output directory (e.g. build/, dist/, out/) for a Node app.
 * Next.js static export uses out/; CRA uses build/; Vite uses dist/.
 */
function detectBuildOutputDir(appDir: string): string | null {
	const candidates = ["out", "build", "dist", ".next"];
	for (const name of candidates) {
		const dir = path.join(appDir, name);
		if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
			// For .next we prefer out/ if it exists (static export). If only .next, Amplify manual deploy is for static; skip .next-only or use out from next export
			if (name === ".next") continue;
			return dir;
		}
	}
	return null;
}

/**
 * Zips the contents of a directory (e.g. build output) for Amplify upload.
 */
async function zipDirectory(
	sourceDir: string,
	outputPath: string,
	ws: any,
	stepId: string
): Promise<string> {
	const send = (msg: string) => {
		if (ws?.readyState === ws?.OPEN) {
			ws.send(JSON.stringify({
				type: "deploy_logs",
				payload: { id: stepId, msg },
			}));
		}
	};
	send("Creating zip from build output...");
	await new Promise<void>((resolve, reject) => {
		const out = fs.createWriteStream(outputPath);
		const archive = archiver("zip", { zlib: { level: 6 } });
		out.on("close", () => resolve());
		archive.on("error", reject);
		out.on("error", reject);
		archive.pipe(out);
		archive.directory(sourceDir, false);
		archive.finalize();
	});
	send(`Zip created: ${path.basename(outputPath)}`);
	return outputPath;
}

/**
 * Uploads a file to a presigned URL (PUT) for Amplify deployment.
 */
async function uploadZipToUrl(
	zipPath: string,
	uploadUrl: string,
	ws: any,
	stepId: string
): Promise<void> {
	const send = (msg: string) => {
		if (ws?.readyState === ws?.OPEN) {
			ws.send(JSON.stringify({
				type: "deploy_logs",
				payload: { id: stepId, msg },
			}));
		}
	};
	send("Uploading zip to Amplify...");
	const buf = fs.readFileSync(zipPath);
	const res = await fetch(uploadUrl, {
		method: "PUT",
		headers: { "Content-Type": "application/zip" },
		body: buf,
	});
	if (!res.ok) {
		throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
	}
	send("Zip upload complete.");
}

/**
 * Parses JSON from AWS CLI output (full output or last line when mixed with progress).
 */
function parseAwsJson(output: string): any {
	const trimmed = output.trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		const lines = trimmed.split("\n").filter((l) => l.trim());
		const last = lines[lines.length - 1];
		return JSON.parse(last || "{}");
	}
}

/**
 * Deploys a Node frontend/static app to AWS Amplify Hosting (zip deploy).
 * Builds the app, zips the build output, creates/gets Amplify app and branch, then deploys.
 */
export async function handleAmplify(
	deployConfig: DeployConfig,
	appDir: string,
	ws: any
): Promise<string> {
	const send = (msg: string, id: string) => {
		if (ws?.readyState === ws.OPEN) {
			ws.send(JSON.stringify({
				type: "deploy_logs",
				payload: { id, msg },
			}));
		}
	};

	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	const appName = generateResourceName(repoName, "amplify").slice(0, 255);
	const branchName = sanitizeBranchName(deployConfig.branch?.trim() || "main");

	send("Authenticating with AWS...", "auth");
	await setupAWSCredentials(ws);

	// Install dependencies
	const installCmd = deployConfig.install_cmd?.trim() || "npm install";
	const [installExec, ...installArgs] = installCmd.split(/\s+/).filter(Boolean);
	send(`Running: ${installCmd}`, "build");
	await runCommandLiveWithWebSocket(
		installExec || "npm",
		installArgs.length ? installArgs : ["install"],
		ws,
		"build",
		{ cwd: appDir }
	);

	// Build
	const buildCmd = deployConfig.build_cmd?.trim() || "npm run build";
	const [buildExec, ...buildArgs] = buildCmd.split(/\s+/).filter(Boolean);
	send(`Running: ${buildCmd}`, "build");
	await runCommandLiveWithWebSocket(
		buildExec || "npm",
		buildArgs.length ? buildArgs : ["run", "build"],
		ws,
		"build",
		{ cwd: appDir }
	);

	const buildOutputDir = detectBuildOutputDir(appDir);
	if (!buildOutputDir) {
		throw new Error(
			"No build output directory found (looked for out/, build/, dist/). Ensure your build script produces one of these."
		);
	}
	send(`Using build output: ${path.basename(buildOutputDir)}`, "build");

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "amplify-deploy-"));
	const zipPath = path.join(tmpDir, "deploy.zip");
	await zipDirectory(buildOutputDir, zipPath, ws, "bundle");

	// Get or create Amplify app
	let appId: string;
	try {
		const listOut = await runAWSCommand(
			["amplify", "list-apps", "--output", "json", "--region", region],
			ws,
			"amplify"
		);
		const list = parseAwsJson(listOut);
		const existing = (list.apps || []).find(
			(a: { name?: string }) => a.name === appName
		);
		if (existing?.appId) {
			appId = existing.appId;
			send(`Using existing Amplify app: ${appName}`, "amplify");
		} else {
			const createOut = await runAWSCommand(
				[
					"amplify", "create-app",
					"--name", appName,
					"--platform", "WEB",
					"--output", "json",
					"--region", region,
				],
				ws,
				"amplify"
			);
			const create = parseAwsJson(createOut);
			appId = create.app?.appId;
			if (!appId) {
				throw new Error("create-app did not return appId");
			}
			send(`Created Amplify app: ${appName}`, "amplify");
		}
	} catch (err: any) {
		if (err.message?.includes("create-app did not return")) throw err;
		send("Retrying create-app (idempotent)...", "amplify");
		const createOut = await runAWSCommand(
			[
				"amplify", "create-app",
				"--name", appName,
				"--platform", "WEB",
				"--output", "json",
				"--region", region,
			],
			ws,
			"amplify"
		);
		const create = parseAwsJson(createOut);
		appId = create.app?.appId;
		if (!appId) {
			throw new Error("Failed to get or create Amplify app: " + (err?.message || "unknown"));
		}
	}

	// Ensure branch exists
	try {
		await runAWSCommand(
			[
				"amplify", "get-branch",
				"--app-id", appId,
				"--branch-name", branchName,
				"--region", region,
			],
			ws,
			"amplify"
		);
	} catch {
		send(`Creating branch: ${branchName}`, "amplify");
		await runAWSCommand(
			[
				"amplify", "create-branch",
				"--app-id", appId,
				"--branch-name", branchName,
				"--region", region,
			],
			ws,
			"amplify"
		);
	}

	// Create deployment (get upload URL)
	send("Creating deployment...", "amplify");
	const deployOut = await runAWSCommand(
		[
			"amplify", "create-deployment",
			"--app-id", appId,
			"--branch-name", branchName,
			"--output", "json",
			"--region", region,
		],
		ws,
		"amplify"
	);
	const deploy = parseAwsJson(deployOut);
	const jobId = deploy.jobId;
	const zipUploadUrl = deploy.zipUploadUrl;
	if (!jobId || !zipUploadUrl) {
		throw new Error("create-deployment did not return jobId or zipUploadUrl");
	}

	await uploadZipToUrl(zipPath, zipUploadUrl, ws, "amplify");

	// Start deployment
	send("Starting deployment...", "amplify");
	await runAWSCommand(
		[
			"amplify", "start-deployment",
			"--app-id", appId,
			"--branch-name", branchName,
			"--job-id", jobId,
			"--region", region,
		],
		ws,
		"amplify"
	);

	// Poll job status
	const maxAttempts = 60;
	const delayMs = 5000;
	let status: string | undefined;
	for (let i = 0; i < maxAttempts; i++) {
		await new Promise((r) => setTimeout(r, delayMs));
		const jobOut = await runAWSCommand(
			[
				"amplify", "get-job",
				"--app-id", appId,
				"--branch-name", branchName,
				"--job-id", jobId,
				"--output", "json",
				"--region", region,
			],
			ws,
			"amplify"
		);
		const job = parseAwsJson(jobOut);
		status = job.jobSummary?.status;
		send(`Deployment status: ${status || "PENDING"} (${i + 1}/${maxAttempts})`, "amplify");
		if (status === "SUCCEED") break;
		if (status === "FAILED" || status === "CANCELLED") {
			throw new Error(`Amplify job ${status}: ${job.jobSummary?.jobArn || jobId}`);
		}
	}
	if (status !== "SUCCEED") {
		send("Deployment is still in progress. Check AWS Amplify console for completion.", "done");
	}

	// Get app default domain and build URL
	let url: string;
	try {
		const appOut = await runAWSCommand(
			["amplify", "get-app", "--app-id", appId, "--output", "json", "--region", region],
			ws,
			"amplify"
		);
		const appJson = parseAwsJson(appOut);
		const defaultDomain = appJson.app?.defaultDomain;
		if (defaultDomain) {
			url = `https://${branchName}.${defaultDomain}`;
		} else {
			url = `https://${region}.console.aws.amazon.com/amplify/home?region=${region}#/${appId}/${branchName}`;
		}
	} catch {
		url = `https://${region}.console.aws.amazon.com/amplify/home?region=${region}#/${appId}/${branchName}`;
	}

	fs.rmSync(tmpDir, { recursive: true, force: true });
	send(`Deployment successful! URL: ${url}`, "done");
	return url;
}
