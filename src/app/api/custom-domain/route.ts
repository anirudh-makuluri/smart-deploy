import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/authOptions";
import { dbHelper } from "@/db-helper";
import { DeployConfig } from "@/app/types";
import config from "@/config";
import { createWebSocketLogger } from "@/lib/websocketLogger";
import { getSubnetIds } from "@/lib/aws/awsHelpers";
import { configureAlb, ServiceDef, NetworkingResult } from "@/lib/aws/handleEC2";
import { addVercelDnsRecord } from "@/lib/vercelDns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CustomDomainRequest = {
	repoName?: string;
	serviceName?: string;
	customUrl?: string;
};

function normalizeCustomUrlInput(value?: string): string | null {
	const trimmed = (value || "").trim();
	if (!trimmed) return null;
	return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function buildServicesForDeployment(deployConfig: DeployConfig): ServiceDef[] {
	const services = (deployConfig.scan_results?.services || []).filter(Boolean);
	const fallbackName = deployConfig.service_name || deployConfig.repo_name;
	if (services.length === 0) {
		return [{ name: fallbackName, dir: ".", port: 8080 }];
	}
	return services.map((svc) => ({
		name: svc.name || fallbackName,
		dir: svc.build_context || ".",
		port: svc.port || 8080,
		relativePath: svc.build_context,
		framework: svc.framework,
		language: svc.language,
	}));
}

async function configureCustomDomainForDeployment(
	deployment: DeployConfig,
	previousCustomUrl: string | null
): Promise<void> {
	const instanceId = deployment.ec2?.instanceId?.trim();
	const vpcId = deployment.ec2?.vpcId?.trim();
	const securityGroupId = deployment.ec2?.securityGroupId?.trim();
	if (!instanceId || !vpcId || !securityGroupId) {
		throw new Error("EC2 metadata missing; cannot reconfigure custom domain.");
	}

	const region = (deployment.awsRegion || config.AWS_REGION).trim();
	if (!region) {
		throw new Error("Missing AWS region for deployment.");
	}

	const subnetIds = await getSubnetIds(vpcId, null);
	if (!subnetIds.length) {
		throw new Error(`Unable to determine subnet IDs in VPC ${vpcId}.`);
	}

	const net: NetworkingResult = {
		vpcId,
		subnetIds,
		securityGroupId,
	};

	const services = buildServicesForDeployment(deployment);
	const certificateArn = config.EC2_ACM_CERTIFICATE_ARN?.trim() || "";
	const send = createWebSocketLogger(null);

	await configureAlb({
		deployConfig: deployment,
		instanceId,
		existingInstanceId: undefined,
		services,
		repoName: deployment.repo_name,
		net,
		region,
		certificateArn,
		ws: null,
		send,
	});

	const deployUrl =
		(deployment.deployUrl || deployment.ec2?.sharedAlbDns || deployment.ec2?.baseUrl || "").trim();
	if (!deployUrl) {
		throw new Error("Missing deployment URL for Vercel DNS configuration.");
	}

	const target = deployment.deploymentTarget ?? "ec2";
	const result = await addVercelDnsRecord(deployUrl, deployment.service_name, {
		deploymentTarget: target,
		previousCustomUrl,
	});

	if (!result.success) {
		throw new Error(result.error ?? "Failed to add Vercel DNS record");
	}
}

export async function POST(req: NextRequest) {
	try {
		const body = (await req.json()) as CustomDomainRequest;
		const { repoName, serviceName, customUrl } = body;
		if (!repoName || !serviceName) {
			return NextResponse.json({ status: "error", message: "repoName and serviceName are required" }, { status: 400 });
		}

		const hasValue = typeof customUrl === "string" && customUrl.trim() !== "";
		const formattedCustomUrl = hasValue ? normalizeCustomUrlInput(customUrl) : null;

		if (hasValue && !formattedCustomUrl) {
			return NextResponse.json({ status: "error", message: "Invalid customUrl format" }, { status: 400 });
		}

		const session = await getServerSession(authOptions);
		const userID = session?.userID;
		const accountMode = session?.accountMode ?? "demo";
		if (!userID) {
			return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
		}
		if (accountMode === "demo") {
			return NextResponse.json({ status: "error", message: "Demo domains are assigned automatically." }, { status: 403 });
		}

		const { deployment, error } = await dbHelper.getDeployment(repoName, serviceName, userID);
		if (error || !deployment) {
			return NextResponse.json({ status: "error", message: "Deployment not found" }, { status: 404 });
		}

		if (deployment.ownerID !== userID) {
			return NextResponse.json({ status: "error", message: "Unauthorized: deployment does not belong to you" }, { status: 403 });
		}		

		const updateResponse = await dbHelper.updateDeployments(
			{
				...deployment,
				custom_url: formattedCustomUrl ?? undefined,
			},
			userID
		);

		if (updateResponse.error) {
			return NextResponse.json({ status: "error", message: "Failed to persist custom domain" }, { status: 500 });
		}

		let configureMessage: string | null = null;
		if (deployment.status === "running" && deployment.ec2?.instanceId && formattedCustomUrl) {
			try {
				const previousCustomUrl = deployment.custom_url || null;
				const updatedDeployment: DeployConfig = {
					...deployment,
					custom_url: formattedCustomUrl ?? undefined,
				};
				await configureCustomDomainForDeployment(
					updatedDeployment,
					previousCustomUrl
				);
				configureMessage = "ALB and Vercel DNS updated";
			} catch (err: any) {
				return NextResponse.json(
					{
						status: "error",
						message: err?.message ?? "Failed to configure infrastructure",
					},
					{ status: 500 }
				);
			}
		}

		const successMessage = formattedCustomUrl
			? configureMessage ?? "Custom domain saved. It will apply after your next deployment."
			: "Custom domain cleared";

		return NextResponse.json({
			status: "success",
			message: successMessage,
			customUrl: formattedCustomUrl,
		});
	} catch (error: any) {
		console.error("Custom domain update error:", error);
		return NextResponse.json({ status: "error", message: error?.message ?? "Internal server error" }, { status: 500 });
	}
}
