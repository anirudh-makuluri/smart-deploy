import fs from "fs";
import path from "path";
import archiver from "archiver";
import config from "../../config";
import { runCommandLiveWithWebSocket } from "../../server-helper";
import { createWebSocketLogger } from "../websocketLogger";

/**
 * Sets up AWS credentials for CLI commands
 */
export async function setupAWSCredentials(ws: any): Promise<void> {
	const send = createWebSocketLogger(ws);

	send("Setting up AWS credentials...", 'auth');

	// Set AWS environment variables for CLI commands
	// If access keys are provided, use them. Otherwise, AWS CLI will use IAM instance role (if on EC2)
	if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
		process.env.AWS_ACCESS_KEY_ID = config.AWS_ACCESS_KEY_ID;
		process.env.AWS_SECRET_ACCESS_KEY = config.AWS_SECRET_ACCESS_KEY;
		send("Using access keys from configuration", 'auth');
	} else {
		send("No access keys found - using IAM instance role (if on EC2) or default credentials", 'auth');
	}
	
	process.env.AWS_DEFAULT_REGION = config.AWS_REGION;

	// Verify credentials
	try {
		const identityOutput = await runCommandLiveWithWebSocket("aws", [
			"sts", "get-caller-identity",
			"--output", "json"
		], ws, 'auth');
		
		// Parse and display identity info
		try {
			const identity = JSON.parse(identityOutput.trim().split('\n').pop() || '{}');
			if (identity.Arn) {
				send(`Authenticated as: ${identity.Arn}`, 'auth');
			}
		} catch {
			// Ignore parsing errors
		}
		
		send("AWS credentials verified successfully", 'auth');
	} catch (error: any) {
		send(`AWS credentials verification failed: ${error.message}`, 'auth');
		if (!config.AWS_ACCESS_KEY_ID || !config.AWS_SECRET_ACCESS_KEY) {
			send("Tip: If not on EC2, provide AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env", 'auth');
		}
		throw new Error("Failed to authenticate with AWS. Please check your credentials or IAM instance role.");
	}
}

/**
 * Runs an AWS CLI command with WebSocket logging
 * Sets PYTHONIOENCODING=utf-8 to prevent Windows charmap encoding errors
 */
export async function runAWSCommand(
	args: string[],
	ws: any,
	stepId: string
): Promise<string> {
	return runCommandLiveWithWebSocket("aws", args, ws, stepId, {
		env: { PYTHONIOENCODING: "utf-8" } as any
	});
}

/**
 * Runs an AWS CLI command with stdout/stderr written to a temp file, then reads the file as UTF-8.
 * Use this for commands that can output Unicode (e.g. get-console-output) to avoid Windows
 * console encoding errors that cause the CLI to exit with code 255.
 */
export async function runAWSCommandToFile(
	args: string[],
	ws: any,
	stepId: string
): Promise<string> {
	const { spawn } = await import("child_process");
	const os = await import("os");
	const outPath = path.join(os.tmpdir(), `aws-console-${Date.now()}.txt`);

	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		const chunks: Buffer[] = [];

		const child = spawn("aws", args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				PYTHONIOENCODING: "utf-8",
				PYTHONLEGACYWINDOWSSTDIO: "1", // Force Python to use UTF-8 on Windows
				LC_ALL: "en_US.UTF-8",
				LANG: "en_US.UTF-8",
			},
			windowsHide: true,
		});

		// Collect stdout as buffers to preserve binary data
		child.stdout?.on("data", (data: Buffer) => {
			chunks.push(data);
		});

		// Collect stderr separately
		child.stderr?.on("data", (data: Buffer) => {
			try {
				// Buffer.toString("utf8") automatically replaces invalid UTF-8 sequences
				stderr += data.toString("utf8");
			} catch {
				// If decode fails for any reason, use latin1 as fallback (preserves all bytes)
				stderr += data.toString("latin1");
			}
		});

		child.on("close", (code) => {
			try {
				// Combine all stdout chunks and decode as UTF-8
				const stdoutBuffer = Buffer.concat(chunks);
				stdout = stdoutBuffer.toString("utf8");

				// Write to file for consistency (though we already have the content)
				fs.writeFileSync(outPath, stdout + (stderr ? "\n" + stderr : ""), "utf8");

				try {
					fs.unlinkSync(outPath);
				} catch {
					// ignore cleanup errors
				}

				if (code === 0) {
					// Include stderr so we capture output when CLI writes to stderr (e.g. get-console-output when stdout is not a TTY)
					const combined = stdout + (stderr ? "\n" + stderr : "");
					resolve(combined.trim() || stdout);
				} else {
					// Sanitize error message to remove problematic Unicode
					const errorMsg = `aws ${args.join(" ")} exited with code ${code}`;
					const errorDetails = (stdout + "\n" + stderr).slice(-500);
					const sanitized = errorDetails.replace(/[\u2190-\u21FF]/g, ""); // Remove arrow Unicode chars
					reject(new Error(`${errorMsg}${sanitized ? "\n" + sanitized : ""}`));
				}
			} catch (e: any) {
				// If file operations fail, still try to return what we have
				if (code === 0 && stdout) {
					resolve(stdout);
				} else {
					reject(e instanceof Error ? e : new Error(String(e)));
				}
			}
		});

		child.on("error", (err) => {
			reject(err);
		});
	});
}

/**
 * Creates an S3 bucket if it doesn't exist
 */
export async function ensureS3Bucket(
	bucketName: string,
	region: string,
	ws: any
): Promise<void> {
	const send = createWebSocketLogger(ws);

	try {
		// Check if bucket exists
		await runAWSCommand([
			"s3api", "head-bucket",
			"--bucket", bucketName
		], ws, 'setup');
		send(`S3 bucket ${bucketName} already exists`, 'setup');
	} catch {
		// Create bucket
		send(`Creating S3 bucket: ${bucketName}...`, 'setup');
		const createArgs = [
			"s3api", "create-bucket",
			"--bucket", bucketName
		];
		
		// LocationConstraint is required for regions other than us-east-1
		if (region !== 'us-east-1') {
			createArgs.push("--create-bucket-configuration", `LocationConstraint=${region}`);
		}
		
		await runAWSCommand(createArgs, ws, 'setup');
		send(`S3 bucket ${bucketName} created`, 'setup');
	}
}

/**
 * Uploads a file to S3
 */
export async function uploadToS3(
	localPath: string,
	bucketName: string,
	s3Key: string,
	ws: any
): Promise<string> {
	const send = createWebSocketLogger(ws);

	send(`Uploading to S3: s3://${bucketName}/${s3Key}...`, 'upload');
	
	await runAWSCommand([
		"s3", "cp",
		localPath,
		`s3://${bucketName}/${s3Key}`
	], ws, 'upload');
	
	send(`Upload complete: s3://${bucketName}/${s3Key}`, 'upload');
	return `s3://${bucketName}/${s3Key}`;
}

/**
 * Creates a ZIP file of a directory using Unix-style path separators (/) in the archive.
 * Required so Elastic Beanstalk's Linux unzip succeeds; Windows Compress-Archive uses backslashes and fails.
 */
export async function createZipBundle(
	sourceDir: string,
	outputPath: string,
	ws: any
): Promise<string> {
	const send = createWebSocketLogger(ws);

	send(`Creating deployment bundle...`, 'bundle');

	await new Promise<void>((resolve, reject) => {
		const out = fs.createWriteStream(outputPath);
		const archive = archiver("zip", { zlib: { level: 6 } });

		out.on("close", () => resolve());
		archive.on("error", (err: Error) => reject(err));
		out.on("error", (err: Error) => reject(err));

		archive.pipe(out);
		// false = directory contents at archive root; archiver uses forward slashes so Linux unzip works
		archive.directory(sourceDir, false, (entry: { name: string }) => {
			// Exclude node_modules, .git, .next; EB runs npm install and npm run build on the instance
			const n = entry.name.replace(/\\/g, "/");
			if (/^(node_modules|\.git|\.next)(\/|$)/.test(n)) return false;
			return entry;
		});
		archive.finalize();
	});

	send(`✅ Deployment bundle created: ${outputPath}`, 'bundle');
	return outputPath;
}

/**
 * Gets the default VPC ID
 */
export async function getDefaultVpcId(ws: any): Promise<string> {
	const output = await runAWSCommand([
		"ec2", "describe-vpcs",
		"--filters", "Name=is-default,Values=true",
		"--query", "Vpcs[0].VpcId",
		"--output", "text"
	], ws, 'setup');
	
	return output.trim();
}

/**
 * Gets subnet IDs for a VPC
 */
export async function getSubnetIds(vpcId: string, ws: any): Promise<string[]> {
	const output = await runAWSCommand([
		"ec2", "describe-subnets",
		"--filters", `Name=vpc-id,Values=${vpcId}`,
		"--query", "Subnets[*].SubnetId",
		"--output", "text"
	], ws, 'setup');
	
	return output.trim().split(/\s+/).filter(Boolean);
}

/**
 * Gets or creates a security group
 */
export async function ensureSecurityGroup(
	groupName: string,
	vpcId: string,
	description: string,
	ws: any
): Promise<string> {
	const send = createWebSocketLogger(ws);

	try {
		// Check if security group exists
		const output = await runAWSCommand([
			"ec2", "describe-security-groups",
			"--filters", `Name=group-name,Values=${groupName}`, `Name=vpc-id,Values=${vpcId}`,
			"--query", "SecurityGroups[0].GroupId",
			"--output", "text"
		], ws, 'setup');
		
		const groupId = output.trim();
		if (groupId && groupId !== 'None') {
			send(`Security group ${groupName} already exists: ${groupId}`, 'setup');
			return groupId;
		}
	} catch {
		// Security group doesn't exist, create it
	}

	// Create security group (key=value with quoted description avoids shell splitting on Windows)
	const quotedDesc = process.platform === 'win32'
		? `"${description.replace(/"/g, '""')}"`
		: `'${description.replace(/'/g, "'\\''")}'`;
	send(`Creating security group: ${groupName}...`, 'setup');
	const createOutput = await runAWSCommand([
		"ec2", "create-security-group",
		`--group-name=${groupName}`,
		`--description=${quotedDesc}`,
		`--vpc-id=${vpcId}`,
		"--query", "GroupId",
		"--output", "text"
	], ws, 'setup');
	
	const groupId = createOutput.trim();
	
	// Add inbound rules for HTTP and HTTPS
	await runAWSCommand([
		"ec2", "authorize-security-group-ingress",
		"--group-id", groupId,
		"--protocol", "tcp",
		"--port", "80",
		"--cidr", "0.0.0.0/0"
	], ws, 'setup');
	
	await runAWSCommand([
		"ec2", "authorize-security-group-ingress",
		"--group-id", groupId,
		"--protocol", "tcp",
		"--port", "443",
		"--cidr", "0.0.0.0/0"
	], ws, 'setup');
	
	send(`Security group created: ${groupId}`, 'setup');
	return groupId;
}

/**
 * Generates a stable resource name from repo name and optional suffix.
 * Uniqueness for deploy artifacts (e.g. S3 zip) comes from version label, not this name.
 */
export function generateResourceName(repoName: string, suffix?: string): string {
	const timestamp = Date.now().toString(36);
	const cleanName = repoName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 20);
	return suffix ? `${cleanName}-${suffix}-${timestamp}` : `${cleanName}-${timestamp}`;
}

/**
 * Waits for a resource to reach a specific state
 */
export async function waitForResource(
	checkCommand: string[],
	expectedValue: string,
	maxAttempts: number = 60,
	delaySeconds: number = 10,
	ws: any
): Promise<boolean> {
	const send = createWebSocketLogger(ws);

	for (let i = 0; i < maxAttempts; i++) {
		try {
			const output = await runAWSCommand(checkCommand, ws, 'wait');
			if (output.trim().includes(expectedValue)) {
				return true;
			}
		} catch {
			// Continue waiting
		}
		
		send(`Waiting for resource... (${i + 1}/${maxAttempts})`, 'wait');
		await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
	}
	
	return false;
}

function getDeploymentBaseDomain(): string {
	const domain = (
		process.env.VERCEL_DOMAIN ||
		process.env.NEXT_PUBLIC_DEPLOYMENT_DOMAIN ||
		""
	).trim();
	if (!domain) return "";
	return domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function sanitizeSubdomain(value: string): string {
	const out = value
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 63);
	return out || "app";
}

export function buildServiceHostname(serviceName: string, preferredSubdomain?: string): string | null {
	const baseDomain = getDeploymentBaseDomain();
	if (!baseDomain) return null;
	const label = sanitizeSubdomain(preferredSubdomain?.trim() || serviceName);
	return `${label}.${baseDomain}`;
}

export async function getAccountId(ws: any): Promise<string> {
	const output = await runAWSCommand([
		"sts", "get-caller-identity",
		"--query", "Account",
		"--output", "text"
	], ws, "auth");
	return output.trim();
}

export async function ensureAlbSecurityGroup(
	albSgName: string,
	vpcId: string,
	ws: any
): Promise<string> {
	const sgId = await ensureSecurityGroup(
		albSgName,
		vpcId,
		`Security group for ALB ${albSgName}`,
		ws
	);

	for (const port of [80, 443]) {
		try {
			await runAWSCommand([
				"ec2",
				"authorize-security-group-ingress",
				"--group-id",
				sgId,
				"--ip-permissions",
				`IpProtocol=tcp,FromPort=${port},ToPort=${port},IpRanges=[{CidrIp=0.0.0.0/0}]`,
			], ws, "setup");
		} catch {
			// likely already exists
		}
	}
	return sgId;
}

export async function allowAlbToReachService(
	serviceSgId: string,
	albSgId: string,
	containerPort: number,
	ws: any
): Promise<void> {
	try {
		await runAWSCommand([
			"ec2",
			"authorize-security-group-ingress",
			"--group-id",
			serviceSgId,
			"--ip-permissions",
			`IpProtocol=tcp,FromPort=${containerPort},ToPort=${containerPort},UserIdGroupPairs=[{GroupId=${albSgId}}]`,
		], ws, "setup");
	} catch {
		// likely already exists
	}
}

async function ensureAlb(
	albName: string,
	subnetIds: string[],
	albSgId: string,
	region: string,
	ws: any
): Promise<{ albArn: string; dnsName: string }> {
	try {
		const albArn = (
			await runAWSCommand(
				[
					"elbv2",
					"describe-load-balancers",
					"--names",
					albName,
					"--query",
					"LoadBalancers[0].LoadBalancerArn",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();
		const dnsName = (
			await runAWSCommand(
				[
					"elbv2",
					"describe-load-balancers",
					"--names",
					albName,
					"--query",
					"LoadBalancers[0].DNSName",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();
		if (albArn && albArn !== "None") return { albArn, dnsName };
	} catch {
		// does not exist
	}

	const albArn = (
		await runAWSCommand(
			[
				"elbv2",
				"create-load-balancer",
				"--name",
				albName,
				"--type",
				"application",
				"--scheme",
				"internet-facing",
				"--subnets",
				...subnetIds,
				"--security-groups",
				albSgId,
				"--query",
				"LoadBalancers[0].LoadBalancerArn",
				"--output",
				"text",
				"--region",
				region,
			],
			ws,
			"deploy"
		)
	).trim();

	const dnsName = (
		await runAWSCommand(
			[
				"elbv2",
				"describe-load-balancers",
				"--load-balancer-arns",
				albArn,
				"--query",
				"LoadBalancers[0].DNSName",
				"--output",
				"text",
				"--region",
				region,
			],
			ws,
			"deploy"
		)
	).trim();

	return { albArn, dnsName };
}

export async function ensureTargetGroup(
	tgName: string,
	vpcId: string,
	containerPort: number,
	region: string,
	ws: any,
	opts?: { targetType?: "ip" | "instance"; healthCheckPath?: string }
): Promise<string> {
	try {
		const tgArn = (
			await runAWSCommand(
				[
					"elbv2",
					"describe-target-groups",
					"--names",
					tgName,
					"--query",
					"TargetGroups[0].TargetGroupArn",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();
		if (tgArn && tgArn !== "None") return tgArn;
	} catch {
		// does not exist
	}

	const targetType = opts?.targetType || "ip";
	const healthCheckPath = opts?.healthCheckPath || "/";

	return (
		await runAWSCommand(
			[
				"elbv2",
				"create-target-group",
				"--name",
				tgName,
				"--protocol",
				"HTTP",
				"--port",
				String(containerPort),
				"--target-type",
				targetType,
				"--vpc-id",
				vpcId,
				"--health-check-protocol",
				"HTTP",
				"--health-check-path",
				healthCheckPath,
				"--query",
				"TargetGroups[0].TargetGroupArn",
				"--output",
				"text",
				"--region",
				region,
			],
			ws,
			"deploy"
		)
	).trim();
}

async function ensureHttpListener(
	albArn: string,
	region: string,
	ws: any,
	opts?: { redirectToHttps?: boolean }
): Promise<string> {
	const redirectToHttps = opts?.redirectToHttps ?? false;
	try {
		const listenerArn = (
			await runAWSCommand(
				[
					"elbv2",
					"describe-listeners",
					"--load-balancer-arn",
					albArn,
					"--query",
					"Listeners[?Port==`80`].ListenerArn[0]",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();
		if (listenerArn && listenerArn !== "None") {
			if (redirectToHttps) {
				await runAWSCommand(
					[
						"elbv2",
						"modify-listener",
						"--listener-arn",
						listenerArn,
						"--default-actions",
						"Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}",
						"--region",
						region,
					],
					ws,
					"deploy"
				);
			}
			return listenerArn;
		}
	} catch {
		// ignore
	}

	const defaultAction = redirectToHttps
		? "Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}"
		: "Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain,MessageBody=NotFound}";

	const createdArn = (
		await runAWSCommand(
			[
				"elbv2",
				"create-listener",
				"--load-balancer-arn",
				albArn,
				"--protocol",
				"HTTP",
				"--port",
				"80",
				"--default-actions",
				defaultAction,
				"--query",
				"Listeners[0].ListenerArn",
				"--output",
				"text",
				"--region",
				region,
			],
			ws,
			"deploy"
		)
	).trim();

	return createdArn;
}

async function ensureHttpsListener(
	albArn: string,
	certificateArn: string,
	region: string,
	ws: any
): Promise<string> {
	try {
		const existing = (
			await runAWSCommand(
				[
					"elbv2",
					"describe-listeners",
					"--load-balancer-arn",
					albArn,
					"--query",
					"Listeners[?Port==`443`].ListenerArn[0]",
					"--output",
					"text",
					"--region",
					region,
				],
				ws,
				"deploy"
			)
		).trim();
		if (existing && existing !== "None") return existing;
	} catch {
		// ignore
	}

	const createdArn = (
		await runAWSCommand(
			[
				"elbv2",
				"create-listener",
				"--load-balancer-arn",
				albArn,
				"--protocol",
				"HTTPS",
				"--port",
				"443",
				"--certificates",
				`CertificateArn=${certificateArn}`,
				"--default-actions",
				"Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain,MessageBody=NotFound}",
				"--query",
				"Listeners[0].ListenerArn",
				"--output",
				"text",
				"--region",
				region,
			],
			ws,
			"deploy"
		)
	).trim();

	return createdArn;
}

export async function ensureHostRule(
	listenerArn: string,
	hostname: string,
	targetGroupArn: string,
	region: string,
	ws: any
): Promise<void> {
	const rulesRaw = await runAWSCommand([
		"elbv2",
		"describe-rules",
		"--listener-arn",
		listenerArn,
		"--output",
		"json",
		"--region",
		region,
	], ws, "deploy");

	let rules: Array<{ Priority?: string; Conditions?: Array<{ Field?: string; HostHeaderConfig?: { Values?: string[] } }>; Actions?: Array<{ Type?: string; TargetGroupArn?: string }> }> = [];
	try {
		const parsed = JSON.parse(rulesRaw);
		rules = Array.isArray(parsed?.Rules) ? parsed.Rules : [];
	} catch {
		rules = [];
	}

	const hasRule = rules.some((rule) =>
		(rule.Conditions || []).some((cond) =>
			cond.Field === "host-header" && (cond.HostHeaderConfig?.Values || []).includes(hostname)
		)
	);
	if (hasRule) return;

	const numericPriorities = rules
		.map((r) => r.Priority)
		.filter((p): p is string => typeof p === "string" && p !== "default")
		.map((p) => Number(p))
		.filter((n) => Number.isFinite(n));

	const maxPriority = numericPriorities.length ? Math.max(...numericPriorities) : 100;
	let priority = maxPriority + 1;
	if (priority > 50000) priority = 50000;

	await runAWSCommand([
		"elbv2",
		"create-rule",
		"--listener-arn",
		listenerArn,
		"--priority",
		String(priority),
		"--conditions",
		`Field=host-header,HostHeaderConfig={Values=${hostname}}`,
		"--actions",
		`Type=forward,TargetGroupArn=${targetGroupArn}`,
		"--region",
		region,
	], ws, "deploy");
}

export async function registerInstanceToTargetGroup(
	targetGroupArn: string,
	instanceId: string,
	port: number,
	region: string,
	ws: any
): Promise<void> {
	await runAWSCommand([
		"elbv2",
		"register-targets",
		"--target-group-arn",
		targetGroupArn,
		"--targets",
		`Id=${instanceId},Port=${port}`,
		"--region",
		region,
	], ws, "deploy");
}

export async function ensureSharedAlb(
	params: {
		vpcId: string;
		subnetIds: string[];
		region: string;
		ws: any;
		certificateArn?: string;
	}
): Promise<{ albArn: string; dnsName: string; albSgId: string; httpListenerArn: string; httpsListenerArn?: string }> {
	const send = createWebSocketLogger(params.ws);
	const accountId = await getAccountId(params.ws);
	const suffix = accountId ? accountId.slice(-6) : "shared";
	const albName = `smartdeploy-${suffix}-alb`.slice(0, 32);
	const albSgName = `smartdeploy-${suffix}-alb-sg`.slice(0, 255);
	const certificateArn = params.certificateArn?.trim() || "";

	send(`Ensuring shared ALB (${albName})...`, "deploy");
	const albSgId = await ensureAlbSecurityGroup(albSgName, params.vpcId, params.ws);
	const { albArn, dnsName } = await ensureAlb(albName, params.subnetIds, albSgId, params.region, params.ws);
	const httpListenerArn = await ensureHttpListener(albArn, params.region, params.ws, {
		redirectToHttps: !!certificateArn,
	});
	const httpsListenerArn = certificateArn
		? await ensureHttpsListener(albArn, certificateArn, params.region, params.ws)
		: undefined;

	return { albArn, dnsName, albSgId, httpListenerArn, httpsListenerArn };
}
