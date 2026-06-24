import {
	ECRClient,
	CreateRepositoryCommand,
	DescribeImagesCommand,
	DescribeRepositoriesCommand,
	GetAuthorizationTokenCommand,
} from "@aws-sdk/client-ecr";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { getAwsClientConfig } from "./sdkClients";

type SendFn = (msg: string, stepId: string) => void;

export async function getAwsAccountId(region: string): Promise<string> {
	const client = new STSClient(getAwsClientConfig(region));
	const resp = await client.send(new GetCallerIdentityCommand({}));
	return resp.Account!;
}

export function getEcrRegistry(accountId: string, region: string): string {
	return `${accountId}.dkr.ecr.${region}.amazonaws.com`;
}

function sanitizeEcrRepositoryPath(value: string): string {
	return value
		.replace(/\\/g, "/")
		.split("/")
		.flatMap((segment) => {
			const trimmed = segment.trim().toLowerCase();
			if (!trimmed || trimmed === "." || trimmed === "..") return [];
			const sanitized = trimmed
				.replace(/[^a-z0-9._-]+/g, "-")
				.replace(/-+/g, "-")
				.replace(/^[-._]+|[-._]+$/g, "");
			return sanitized ? [sanitized] : [];
		})
		.join("/");
}

export function buildScopedEcrRepoName(repoName: string, packagePath?: string | null): string {
	const repoPath = sanitizeEcrRepositoryPath(repoName) || "app";
	const scopedPackagePath = sanitizeEcrRepositoryPath(packagePath ?? "");
	return scopedPackagePath ? `sd/${repoPath}/${scopedPackagePath}` : `sd/${repoPath}`;
}

export function getEcrImageUri(
	accountId: string,
	region: string,
	repoName: string,
	tag: string,
): string {
	return `${getEcrRegistry(accountId, region)}/${repoName}:${tag}`;
}

export async function ensureEcrRepository(
	repoName: string,
	region: string,
	send: SendFn,
): Promise<string> {
	const client = new ECRClient(getAwsClientConfig(region));

	try {
		const resp = await client.send(
			new DescribeRepositoriesCommand({ repositoryNames: [repoName] }),
		);
		const uri = resp.repositories?.[0]?.repositoryUri;
		if (uri) return uri;
	} catch (e: any) {
		if (e.name !== "RepositoryNotFoundException") throw e;
	}

	send(`Creating ECR repository: ${repoName}...`, "build");
	const resp = await client.send(
		new CreateRepositoryCommand({
			repositoryName: repoName,
			imageScanningConfiguration: { scanOnPush: false },
			imageTagMutability: "MUTABLE",
		}),
	);
	send(`ECR repository created: ${repoName}`, "build");
	return resp.repository!.repositoryUri!;
}

export async function ecrImageTagExists(
	region: string,
	repoName: string,
	tag: string,
): Promise<boolean> {
	const client = new ECRClient(getAwsClientConfig(region));
	try {
		const resp = await client.send(
			new DescribeImagesCommand({
				repositoryName: repoName,
				imageIds: [{ imageTag: tag }],
			}),
		);
		return Boolean(resp.imageDetails && resp.imageDetails.length > 0);
	} catch (e: any) {
		if (e.name === "ImageNotFoundException") return false;
		throw e;
	}
}

export async function describeEcrImageByTag(
	region: string,
	repoName: string,
	tag: string,
): Promise<{ imageDigest?: string | null; imageTags: string[] }> {
	const client = new ECRClient(getAwsClientConfig(region));
	const resp = await client.send(
		new DescribeImagesCommand({
			repositoryName: repoName,
			imageIds: [{ imageTag: tag }],
		}),
	);
	const image = resp.imageDetails?.[0];
	if (!image) {
		return { imageDigest: null, imageTags: [] };
	}
	return {
		imageDigest: image.imageDigest ?? null,
		imageTags: image.imageTags ?? [],
	};
}

export async function getEcrAuthToken(region: string): Promise<{ username: string; password: string }> {
	const client = new ECRClient(getAwsClientConfig(region));
	const resp = await client.send(new GetAuthorizationTokenCommand({}));
	const auth = resp.authorizationData?.[0];
	const token = auth?.authorizationToken;
	if (!token) throw new Error("ECR authorization token missing");
	const decoded = Buffer.from(token, "base64").toString("utf8");
	const sep = decoded.indexOf(":");
	if (sep === -1) throw new Error("Invalid ECR auth token format");
	return {
		username: decoded.slice(0, sep),
		password: decoded.slice(sep + 1),
	};
}

