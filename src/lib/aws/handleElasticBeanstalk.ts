import fs from "fs";
import os from "os";
import path from "path";
import config from "../../config";
import { DeployConfig, ElasticBeanstalkDeployDetails } from "../../app/types";
import { createWebSocketLogger } from "../websocketLogger";
import { 
	setupAWSCredentials, 
	runAWSCommand, 
	ensureS3Bucket, 
	uploadToS3, 
	createZipBundle,
	generateResourceName 
} from "./awsHelpers";
import { getEBSolutionStack } from "./awsDeploymentSelector";

/**
 * Detects the language of an application
 */
function detectLanguage(appDir: string): string {
	if (fs.existsSync(path.join(appDir, "package.json"))) return "node";
	if (fs.existsSync(path.join(appDir, "requirements.txt"))) return "python";
	if (fs.existsSync(path.join(appDir, "go.mod"))) return "go";
	if (fs.existsSync(path.join(appDir, "pom.xml")) || fs.existsSync(path.join(appDir, "build.gradle"))) return "java";
	if (fs.existsSync(path.join(appDir, "composer.json"))) return "php";
	if (fs.existsSync(path.join(appDir, "Gemfile"))) return "ruby";
	
	const files = fs.readdirSync(appDir);
	if (files.some(f => f.endsWith(".csproj") || f.endsWith(".sln"))) return "dotnet";
	
	return "node"; // Default fallback
}

/**
 * Validates Node app has a start script (EB runs npm start); avoids opaque "Engine execution has encountered an error"
 */
function validateNodeApp(appDir: string, runCmd: string): void {
	if (!runCmd.trim().toLowerCase().startsWith("npm start") && !runCmd.trim().toLowerCase().startsWith("node ")) return;
	const pkgPath = path.join(appDir, "package.json");
	if (!fs.existsSync(pkgPath)) {
		throw new Error(
			"Elastic Beanstalk Node deployment requires package.json in the deployment directory. " +
			"If using a workdir, that folder must contain its own package.json with a \"start\" script."
		);
	}
	let pkg: { scripts?: { start?: string } };
	try {
		pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
	} catch {
		throw new Error("package.json in the deployment directory is invalid JSON.");
	}
	if (!pkg.scripts?.start) {
		throw new Error(
			"package.json must have a \"start\" script (e.g. \"start\": \"node server.js\") for Elastic Beanstalk. " +
			"Add it under \"scripts\" and redeploy."
		);
	}
}

/**
 * Creates Procfile for Elastic Beanstalk if not exists
 */
function ensureProcfile(appDir: string, runCmd: string): void {
	const procfilePath = path.join(appDir, "Procfile");
	if (!fs.existsSync(procfilePath)) {
		fs.writeFileSync(procfilePath, `web: ${runCmd}\n`);
	}
}

/**
 * Creates .ebextensions for configuration if needed.
 * For Next.js (package has "next" + build script), adds a deploy-time build so "next start" works.
 */
function createEBExtensions(appDir: string, port: number = 8080): void {
	const ebextDir = path.join(appDir, ".ebextensions");
	if (!fs.existsSync(ebextDir)) {
		fs.mkdirSync(ebextDir, { recursive: true });
	}

	const optionsConfig = `
option_settings:
  aws:elasticbeanstalk:application:environment:
    PORT: "${port}"
  aws:elasticbeanstalk:container:nodejs:
    NodeCommand: ""
  aws:elasticbeanstalk:command:
    Timeout: "1800"
`.trim();
	fs.writeFileSync(path.join(ebextDir, "options.config"), optionsConfig);

	const pkgPath = path.join(appDir, "package.json");
	if (!fs.existsSync(pkgPath)) return;

	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: { build?: string } };
		const hasNext = pkg.dependencies?.next ?? pkg.devDependencies?.next;
		const hasBuild = pkg.scripts?.build;
		if (hasNext && !hasBuild) {
			throw new Error(
				"Next.js app must have a \"build\" script in package.json (e.g. \"build\": \"next build\") for Elastic Beanstalk SSR deployment."
			);
		}
		// EB platform runs "npm install --production" (skips devDependencies). Set NPM_CONFIG_PRODUCTION=false
		// and run full "npm install" so devDeps (e.g. next) are available.
		const fullInstallConfig = `
container_commands:
  00_npm_install:
    command: "NPM_CONFIG_PRODUCTION=false npm install"
    leader_only: true
`.trim();
		fs.writeFileSync(path.join(ebextDir, "00_npm_install.config"), fullInstallConfig);

		// Next.js: run "npm run build" so .next exists before "next start". Use NODE_OPTIONS for memory (build can be heavy).
		if (hasNext && hasBuild) {
			const buildConfig = `
container_commands:
  01_npm_run_build:
    command: "NODE_OPTIONS=--max-old-space-size=4096 npm run build"
    leader_only: true
`.trim();
			fs.writeFileSync(path.join(ebextDir, "01_build.config"), buildConfig);
		}
	} catch (e) {
		if (e instanceof Error && e.message?.includes("Next.js app must have")) throw e;
		// ignore invalid package.json
	}
}

/**
 * Handles deployment to AWS Elastic Beanstalk
 */
export async function handleElasticBeanstalk(
	deployConfig: DeployConfig,
	appDir: string,
	ws: any
): Promise<{  success: boolean, url: string; details: ElasticBeanstalkDeployDetails }> {
	const send = createWebSocketLogger(ws);

	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	// Reuse stored EB app/env names when available (redeploy), otherwise generate new ones
	const appName = deployConfig.elasticBeanstalk?.appName?.trim() || generateResourceName(repoName, "eb");
	const envName = deployConfig.elasticBeanstalk?.envName?.trim() || `${appName}-env`;
	const versionLabel = `v-${Date.now()}`;
	const bucketName = deployConfig.elasticBeanstalk?.s3Bucket?.trim() || `smartdeploy-eb-${config.AWS_ACCESS_KEY_ID.slice(-8).toLowerCase()}`;

	// Detect language and get solution stack
	const language = detectLanguage(appDir);
	const solutionStack = getEBSolutionStack(language);
	
	if (!solutionStack) {
		throw new Error(`Language ${language} is not supported by Elastic Beanstalk`);
	}

	send(`✅ Detected ${language} application. Using solution stack: ${solutionStack}`, 'detect');

	const runCmd = deployConfig.core_deployment_info?.run_cmd || (language === 'node' ? 'npm start' : 'python app.py');
	if (language === 'node') validateNodeApp(appDir, runCmd);
	ensureProcfile(appDir, runCmd);
	
	// Create .ebextensions
	createEBExtensions(appDir, deployConfig.core_deployment_info?.port || 8080);

	// Ensure S3 bucket exists for deployment artifacts
	send("Setting up S3 bucket for deployment artifacts...", 'setup');
	await ensureS3Bucket(bucketName, region, ws);
	send("✅ S3 bucket setup completed", 'setup');

	// Create deployment bundle
	send("Creating deployment bundle...", 'bundle');
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-deploy-"));
	const zipPath = path.join(tmpDir, `${appName}.zip`);
	await createZipBundle(appDir, zipPath, ws);
	send("✅ Deployment bundle created", 'bundle');

	// Upload to S3
	const s3Key = `${appName}/${versionLabel}.zip`;
	await uploadToS3(zipPath, bucketName, s3Key, ws);
	send("✅ Deployment bundle uploaded to S3", 'upload');

	// Create Elastic Beanstalk application
	// Use key=value with quoted value so description with spaces (e.g. "SmartDeploy: portfolio-website") is not split by shell
	const description = `SmartDeploy: ${repoName}`;
	const quotedDescription = process.platform === 'win32' ? `"${description.replace(/"/g, '""')}"` : `'${description.replace(/'/g, "'\\''")}'`;
	send(`Creating Elastic Beanstalk application: ${appName}...`, 'deploy');
	try {
		await runAWSCommand([
			"elasticbeanstalk", "create-application",
			`--application-name=${appName}`,
			`--description=${quotedDescription}`,
			`--region=${region}`
		], ws, 'deploy');
	} catch (error: any) {
		if (!error.message?.includes("already exists")) {
			throw error;
		}
		send(`Application ${appName} already exists, using existing application`, 'deploy');
	}

	// Create application version (key=value form avoids shell splitting)
	send(`Creating application version: ${versionLabel}...`, 'deploy');
	await runAWSCommand([
		"elasticbeanstalk", "create-application-version",
		`--application-name=${appName}`,
		`--version-label=${versionLabel}`,
		`--source-bundle=S3Bucket=${bucketName},S3Key=${s3Key}`,
		`--region=${region}`
	], ws, 'deploy');

	// Check if environment exists
	let environmentExists = false;
	try {
		const envOutput = await runAWSCommand([
			"elasticbeanstalk", "describe-environments",
			`--application-name=${appName}`,
			`--environment-names=${envName}`,
			"--query", "Environments[0].Status",
			"--output", "text",
			`--region=${region}`
		], ws, 'deploy');
		
		if (envOutput.trim() && envOutput.trim() !== 'None') {
			environmentExists = true;
		}
	} catch {
		// Environment doesn't exist
	}

	if (environmentExists) {
		// Update existing environment (optionally add HTTPS listener if cert is set)
		send(`Updating environment: ${envName}...`, 'deploy');
		const updateEnvArgs = [
			"elasticbeanstalk", "update-environment",
			`--application-name=${appName}`,
			`--environment-name=${envName}`,
			`--version-label=${versionLabel}`,
			`--region=${region}`
		];
		const acmCertArn = config.EB_ACM_CERTIFICATE_ARN?.trim();
		if (acmCertArn) {
			const httpsOptions = [
				"Namespace=aws:elbv2:listener:443,OptionName=ListenerEnabled,Value=true",
				"Namespace=aws:elbv2:listener:443,OptionName=Protocol,Value=HTTPS",
				`Namespace=aws:elbv2:listener:443,OptionName=SSLCertificateArns,Value=${acmCertArn}`
			];
			updateEnvArgs.push("--option-settings", httpsOptions.join(" "));
			send("Adding HTTPS listener (port 443) with your ACM certificate.", "deploy");
		}
		await runAWSCommand(updateEnvArgs, ws, 'deploy');
	} else {
		// Create new environment
		send(`Creating environment: ${envName}...`, 'deploy');
		
		// Instance profile (EC2 role) and service role (used by EB service) – both required
		const instanceProfileName = process.env.AWS_EB_INSTANCE_PROFILE || "aws-elasticbeanstalk-ec2-role";
		const serviceRoleName = process.env.AWS_EB_SERVICE_ROLE || "aws-elasticbeanstalk-service-role";

		// Option settings: instance profile + service role + env vars
		const optionSettings: string[] = [
			`Namespace=aws:autoscaling:launchconfiguration,OptionName=IamInstanceProfile,Value=${instanceProfileName}`,
			`Namespace=aws:elasticbeanstalk:environment,OptionName=ServiceRole,Value=${serviceRoleName}`
		];
		const acmCertArn = config.EB_ACM_CERTIFICATE_ARN?.trim();
		if (acmCertArn) {
			optionSettings.push("Namespace=aws:elasticbeanstalk:environment,OptionName=EnvironmentType,Value=LoadBalanced");
			optionSettings.push("Namespace=aws:elbv2:listener:443,OptionName=ListenerEnabled,Value=true");
			optionSettings.push("Namespace=aws:elbv2:listener:443,OptionName=Protocol,Value=HTTPS");
			optionSettings.push(`Namespace=aws:elbv2:listener:443,OptionName=SSLCertificateArns,Value=${acmCertArn}`);
			send("HTTPS listener (port 443) will be configured with your ACM certificate.", "deploy");
		}
		if (deployConfig.env_vars) {
			const vars = deployConfig.env_vars.split(',');
			for (const v of vars) {
				const [key, value] = v.split('=');
				if (key && value) {
					optionSettings.push(`Namespace=aws:elasticbeanstalk:application:environment,OptionName=${key.trim()},Value=${value.trim()}`);
				}
			}
		}

		// Solution stack name contains spaces – quote so the shell (Windows) doesn't split it
		const quotedStack = process.platform === "win32"
			? `--solution-stack-name="${solutionStack.replace(/"/g, '""')}"`
			: `--solution-stack-name='${solutionStack.replace(/'/g, "'\"'\"'")}'`;
		const createEnvArgs = [
			"elasticbeanstalk", "create-environment",
			`--application-name=${appName}`,
			`--environment-name=${envName}`,
			`--version-label=${versionLabel}`,
			quotedStack,
			"--option-settings", optionSettings.join(" "),
			`--region=${region}`
		];

		await runAWSCommand(createEnvArgs, ws, 'deploy');
	}

	// Wait for environment to be Ready and healthy (Green or Yellow). Red/Severe = deployment failed (e.g. command timeout).
	const HEALTH_OK = ['Green', 'Yellow'];
	const HEALTH_BAD = ['Red', 'Severe', 'Grey'];
	send("Waiting for environment to be ready and healthy (this may take several minutes)...", 'deploy');
	
	let attempts = 0;
	const maxAttempts = 60;
	let deployedUrl = '';
	
	while (attempts < maxAttempts) {
		try {
			const statusOutput = await runAWSCommand([
				"elasticbeanstalk", "describe-environments",
				`--application-name=${appName}`,
				`--environment-names=${envName}`,
				"--query", "Environments[0].[Status,Health,CNAME]",
				"--output", "text",
				`--region=${region}`
			], ws, 'deploy');

			const parts = statusOutput.trim().split(/\s+/);
			const status = parts[0] || '';
			const health = parts[1] || '';
			const cname = parts[2] || (parts[1]?.includes('.') ? parts[1] : '');
			
			if (status === 'Ready' && HEALTH_OK.includes(health) && cname) {
				deployedUrl = `http://${cname}`;
				break;
			}
			
			if (status === 'Ready' && HEALTH_BAD.includes(health)) {
				send(`Environment is Ready but health is ${health}. Deployment may have timed out (e.g. npm install/build). Check AWS EB console for logs.`, 'deploy');
				throw new Error(
					`Elastic Beanstalk environment health is ${health}. The deployment command likely timed out on the instance. ` +
					`Try increasing the timeout in AWS EB configuration or check the EB environment events/logs for errors.`
				);
			}
			
			send(`Environment status: ${status}, Health: ${health} (${attempts + 1}/${maxAttempts})`, 'deploy');
		} catch (error: any) {
			if (error?.message?.includes('Elastic Beanstalk environment health')) throw error;
			// Continue waiting
		}
		
		attempts++;
		await new Promise(resolve => setTimeout(resolve, 10000));
	}

	if (!deployedUrl) {
		// After timeout: only use URL if health is actually OK
		try {
			const statusOutput = await runAWSCommand([
				"elasticbeanstalk", "describe-environments",
				`--application-name=${appName}`,
				`--environment-names=${envName}`,
				"--query", "Environments[0].[Status,Health,CNAME]",
				"--output", "text",
				`--region=${region}`
			], ws, 'deploy');
			const parts = statusOutput.trim().split(/\s+/);
			const status = parts[0];
			const health = parts[1] || '';
			const cname = parts[2] || (parts[1]?.includes('.') ? parts[1] : '');
			if (status === 'Ready' && HEALTH_OK.includes(health) && cname) {
				deployedUrl = `http://${cname}`;
			} else if (status === 'Ready' && HEALTH_BAD.includes(health)) {
				throw new Error(
					`Elastic Beanstalk did not become healthy (health: ${health}) within the wait time. ` +
					`The deployment command may have timed out. Check the EB environment in AWS Console for details.`
				);
			}
		} catch (err: any) {
			if (err?.message?.includes('Elastic Beanstalk')) throw err;
			// Ignore other errors
		}
	}

	// Cleanup temp files
	fs.rmSync(tmpDir, { recursive: true, force: true });

	const ebDetails: ElasticBeanstalkDeployDetails = { success: true, appName, envName, s3Bucket: bucketName };

	if (deployedUrl) {
		send(`✅ Deployment successful! Application URL: ${deployedUrl}`, 'done');
		return { success: true, url: deployedUrl, details: ebDetails };
	}
	send("❌ Environment did not become healthy in time. Check AWS Elastic Beanstalk console for events and instance logs.", 'deploy');
	throw new Error(
		"Elastic Beanstalk environment did not become healthy (Green/Yellow) within the wait time. " +
		"Check the EB environment in AWS Console — the deployment command may have timed out (e.g. npm install or npm run build)."
	);
}
