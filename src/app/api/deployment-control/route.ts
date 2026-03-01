import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { EC2Client, StopInstancesCommand, StartInstancesCommand } from "@aws-sdk/client-ec2";
import { runCommandLiveWithOutput } from "@/server-helper";
import config from "@/config";
import { authOptions } from "../auth/authOptions";
import { dbHelper } from "@/db-helper";
import type { DeployConfig } from "@/app/types";

export async function PUT(req: NextRequest) {
	try {
		const { serviceName, action, deploymentId } = await req.json();

		if (!action) {
			return NextResponse.json({ error: "Missing action" }, { status: 400 });
		}

		// Preferred path: control AWS deployment by deploymentId (EC2 pause/resume)
		if (deploymentId) {
			const session = await getServerSession(authOptions);
			const userID = session?.userID;
			if (!userID) {
				return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
			}

			const { deployment, error } = await dbHelper.getDeployment(deploymentId);
			if (error || !deployment) {
				return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
			}
			if (deployment.ownerID !== userID) {
				return NextResponse.json({ error: "Forbidden: deployment does not belong to user" }, { status: 403 });
			}

			const deployConfig = deployment as DeployConfig;
			const cloudProvider = deployConfig.cloudProvider || "aws";

			// Currently only EC2 is supported for pause/resume.
			if (cloudProvider === "aws" && deployConfig.deploymentTarget === "ec2") {
				const instanceId = deployConfig.ec2?.instanceId;
				if (!instanceId) {
					return NextResponse.json({ error: "No EC2 instanceId stored for this deployment" }, { status: 400 });
				}

				const region = deployConfig.awsRegion || config.AWS_REGION || "us-west-2";
				const clientConfig: ConstructorParameters<typeof EC2Client>[0] = { region };
				if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
					clientConfig.credentials = {
						accessKeyId: config.AWS_ACCESS_KEY_ID,
						secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
					};
				}
				const ec2 = new EC2Client(clientConfig);

				if (action === "pause") {
					await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
					return NextResponse.json({ status: "success", message: "EC2 instance stopping" });
				}
				if (action === "resume") {
					await ec2.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
					return NextResponse.json({ status: "success", message: "EC2 instance starting" });
				}

				return NextResponse.json({ error: "Invalid action for AWS EC2. Must be pause or resume." }, { status: 400 });
			}
			// For non-AWS or non-EC2 deployments, fall through to legacy Cloud Run logic below (if serviceName provided).
		}

		// Legacy path: Cloud Run control by serviceName (pause/resume/stop)
		if (!serviceName) {
			return NextResponse.json({ error: "Missing service name for legacy Cloud Run control" }, { status: 400 });
		}

		const region = "us-central1";
		const projectId = config.GCP_PROJECT_ID;
		const commands: Record<string, string[]> = {
			pause: ["run", "services", "update-traffic", serviceName, "--project", projectId, "--to-zero", "--region", region, "--platform=managed"],
			resume: ["run", "services", "update-traffic", serviceName, "--project", projectId, "--to-latest", "--region", region, "--platform=managed"],
			stop: ["run", "services", "delete", serviceName, "--project", projectId, "--region", region, "--platform=managed", "--quiet"],
		};

		const args = commands[action];

		if (!args) {
			return NextResponse.json({ error: "Invalid action. Must be pause, resume, or stop" }, { status: 400 });
		}

		try {
			const output = await runCommandLiveWithOutput("gcloud", args);
			return NextResponse.json({ status: "success", message: output });
		} catch (cmdErr: any) {
			if (action === "stop" && cmdErr.message?.includes("could not be found")) {
				return NextResponse.json({ status: "success", message: "Service already deleted or not found" });
			}
			throw cmdErr;
		}
	} catch (err: any) {
		console.error("Service control error:", err);
		return NextResponse.json({ status: "error", message: err.message }, { status: 500 });
	}
}
