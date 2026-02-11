import fs from "fs";
import path from "path";
import archiver from "archiver";
import config from "../../config";
import { runCommandLiveWithWebSocket } from "../../server-helper";

/**
 * Sets up AWS credentials for CLI commands
 */
export async function setupAWSCredentials(ws: any): Promise<void> {
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

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
 */
export async function runAWSCommand(
	args: string[],
	ws: any,
	stepId: string
): Promise<string> {
	return runCommandLiveWithWebSocket("aws", args, ws, stepId);
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
	const fd = fs.openSync(outPath, "w");

	return new Promise((resolve, reject) => {
		const child = spawn("aws", args, {
			stdio: ["ignore", fd, fd],
			env: process.env,
			windowsHide: true,
		});
		child.on("close", (code) => {
			fs.closeSync(fd);
			try {
				const content = fs.readFileSync(outPath, "utf8");
				try {
					fs.unlinkSync(outPath);
				} catch {
					// ignore
				}
				if (code === 0) {
					resolve(content);
				} else {
					reject(new Error(`aws ${args.join(" ")} exited with code ${code}${content ? "\n" + content.slice(-500) : ""}`));
				}
			} catch (e) {
				reject(e);
			}
		});
		child.on("error", (err) => {
			fs.closeSync(fd);
			try { fs.unlinkSync(outPath); } catch { /* ignore */ }
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
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

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
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

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
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = { type: 'deploy_logs', payload: { id, msg } };
			ws.send(JSON.stringify(object));
		}
	};

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
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

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
	const send = (msg: string, id: string) => {
		if (ws && ws.readyState === ws.OPEN) {
			const object = {
				type: 'deploy_logs',
				payload: { id, msg }
			};
			ws.send(JSON.stringify(object));
		}
	};

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
