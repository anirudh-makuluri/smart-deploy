import fs from "fs";
import os from "os";
import path from "path";
import config from "../../config";
import { DeployConfig } from "../../app/types";
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
`.trim();
	fs.writeFileSync(path.join(ebextDir, "options.config"), optionsConfig);

	const pkgPath = path.join(appDir, "package.json");
	if (!fs.existsSync(pkgPath)) return;

	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: { build?: string } };
		// EB platform runs "npm install --production" (skips devDependencies). Set NPM_CONFIG_PRODUCTION=false
		// and run full "npm install" so devDeps (e.g. next) are available.
		const fullInstallConfig = `
container_commands:
  00_npm_install:
    command: "NPM_CONFIG_PRODUCTION=false npm install"
    leader_only: true
`.trim();
		fs.writeFileSync(path.join(ebextDir, "00_npm_install.config"), fullInstallConfig);

		// Next.js: run "npm run build" so .next exists before "next start".
		const hasNext = pkg.dependencies?.next ?? pkg.devDependencies?.next;
		const hasBuild = pkg.scripts?.build;
		if (hasNext && hasBuild) {
			const buildConfig = `
container_commands:
  01_npm_run_build:
    command: "npm run build"
    leader_only: true
`.trim();
			fs.writeFileSync(path.join(ebextDir, "01_build.config"), buildConfig);
		}
	} catch {
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

	const region = deployConfig.awsRegion || config.AWS_REGION;
	const repoName = deployConfig.url.split("/").pop()?.replace(".git", "") || "app";
	const appName = generateResourceName(repoName, "eb");
	const envName = `${appName}-env`;
	const versionLabel = `v-${Date.now()}`;
	const bucketName = `smartdeploy-eb-${config.AWS_ACCESS_KEY_ID.slice(-8).toLowerCase()}`;

	// Setup AWS credentials
	send("Authenticating with AWS...", 'auth');
	await setupAWSCredentials(ws);

	// Detect language and get solution stack
	const language = detectLanguage(appDir);
	const solutionStack = getEBSolutionStack(language);
	
	if (!solutionStack) {
		throw new Error(`Language ${language} is not supported by Elastic Beanstalk`);
	}

	send(`Detected ${language} application. Using solution stack: ${solutionStack}`, 'detect');

	const runCmd = deployConfig.run_cmd || (language === 'node' ? 'npm start' : 'python app.py');
	if (language === 'node') validateNodeApp(appDir, runCmd);
	ensureProcfile(appDir, runCmd);
	
	// Create .ebextensions
	createEBExtensions(appDir, deployConfig.core_deployment_info?.port || 8080);

	// Ensure S3 bucket exists for deployment artifacts
	send("Setting up S3 bucket for deployment artifacts...", 'setup');
	await ensureS3Bucket(bucketName, region, ws);

	// Create deployment bundle
	send("Creating deployment bundle...", 'bundle');
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-deploy-"));
	const zipPath = path.join(tmpDir, `${appName}.zip`);
	await createZipBundle(appDir, zipPath, ws);

	// Upload to S3
	const s3Key = `${appName}/${versionLabel}.zip`;
	await uploadToS3(zipPath, bucketName, s3Key, ws);

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
		// Update existing environment
		send(`Updating environment: ${envName}...`, 'deploy');
		await runAWSCommand([
			"elasticbeanstalk", "update-environment",
			`--application-name=${appName}`,
			`--environment-name=${envName}`,
			`--version-label=${versionLabel}`,
			`--region=${region}`
		], ws, 'deploy');
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

	// Wait for environment to be ready
	send("Waiting for environment to be ready (this may take several minutes)...", 'deploy');
	
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

			const [status, health, cname] = statusOutput.trim().split(/\s+/);
			
			if (status === 'Ready' && health === 'Green') {
				deployedUrl = `http://${cname}`;
				break;
			}
			
			if (status === 'Ready') {
				deployedUrl = `http://${cname}`;
				send(`Environment ready but health is ${health}. Continuing...`, 'deploy');
				break;
			}
			
			send(`Environment status: ${status}, Health: ${health} (${attempts + 1}/${maxAttempts})`, 'deploy');
		} catch (error) {
			// Continue waiting
		}
		
		attempts++;
		await new Promise(resolve => setTimeout(resolve, 10000));
	}

	if (!deployedUrl) {
		// Try to get URL anyway
		try {
			const urlOutput = await runAWSCommand([
				"elasticbeanstalk", "describe-environments",
				`--application-name=${appName}`,
				`--environment-names=${envName}`,
				"--query", "Environments[0].CNAME",
				"--output", "text",
				`--region=${region}`
			], ws, 'deploy');
			
			if (urlOutput.trim() && urlOutput.trim() !== 'None') {
				deployedUrl = `http://${urlOutput.trim()}`;
			}
		} catch {
			// Ignore
		}
	}

	// Cleanup temp files
	fs.rmSync(tmpDir, { recursive: true, force: true });

	if (deployedUrl) {
		send(`Deployment successful! Application URL: ${deployedUrl}`, 'done');
		return deployedUrl;
	} else {
		send("Deployment initiated but URL not available yet. Check AWS Console.", 'done');
		return `https://${region}.console.aws.amazon.com/elasticbeanstalk/home?region=${region}#/environment/dashboard?applicationName=${appName}&environmentName=${envName}`;
	}
}
