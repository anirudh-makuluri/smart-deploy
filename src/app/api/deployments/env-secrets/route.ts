import { NextResponse } from "next/server";
import { dbHelper } from "@/db-helper";
import { auth } from "@/lib/auth";
import config from "@/config";
import {
	getDeploymentEnvSecretEntries,
	type EnvSecretEntry,
	upsertDeploymentEnvSecret,
} from "@/lib/aws/deploymentSecrets";
import type { DeployConfig } from "@/app/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SaveBody = {
	repoName?: string;
	serviceName?: string;
	entries?: EnvSecretEntry[];
	region?: string;
};

function parseRepoService(searchParams: URLSearchParams): { repoName: string; serviceName: string } | null {
	const repoName = searchParams.get("repoName")?.trim() ?? "";
	const serviceName = searchParams.get("serviceName")?.trim() ?? "";
	if (!repoName || !serviceName) return null;
	return { repoName, serviceName };
}

function normalizeEntries(raw: unknown): EnvSecretEntry[] {
	if (!Array.isArray(raw)) return [];
	const out: EnvSecretEntry[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const name = typeof (item as EnvSecretEntry).name === "string" ? (item as EnvSecretEntry).name.trim() : "";
		const value = typeof (item as EnvSecretEntry).value === "string" ? (item as EnvSecretEntry).value : "";
		if (!name) continue;
		out.push({ name, value });
	}
	return out;
}

async function loadOwnedDeployment(userID: string, repoName: string, serviceName: string) {
	const result = await dbHelper.getDeploymentForUser(repoName, serviceName, userID);
	if (result.error || !result.deployment) {
		return { error: NextResponse.json({ error: "Deployment not found" }, { status: 404 }) };
	}
	return { deployment: result.deployment };
}

function resolveRegion(deployment: DeployConfig, override?: string): string {
	const fromBody = override?.trim();
	if (fromBody) return fromBody;
	const fromDeployment = deployment.region?.trim();
	if (fromDeployment) return fromDeployment;
	return config.AWS_REGION;
}

export async function GET(req: Request) {
	const session = await auth.api.getSession({ headers: req.headers });
	const userID = session?.user?.id;
	if (!userID) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const parsed = parseRepoService(new URL(req.url).searchParams);
	if (!parsed) {
		return NextResponse.json({ error: "Missing repoName or serviceName" }, { status: 400 });
	}

	const owned = await loadOwnedDeployment(userID, parsed.repoName, parsed.serviceName);
	if ("error" in owned && owned.error) return owned.error;
	const deployment = owned.deployment!;

	const secretsArn = deployment.secretsArn?.trim();
	if (!secretsArn) {
		return NextResponse.json({ secretsArn: null, entries: [] });
	}

	try {
		const entries = await getDeploymentEnvSecretEntries({
			region: resolveRegion(deployment),
			secretsArn,
		});
		return NextResponse.json({ secretsArn, entries });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to load deployment secrets";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}

export async function PUT(req: Request) {
	const session = await auth.api.getSession({ headers: req.headers });
	const userID = session?.user?.id;
	if (!userID) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: SaveBody;
	try {
		body = (await req.json()) as SaveBody;
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const repoName = String(body.repoName ?? "").trim();
	const serviceName = String(body.serviceName ?? "").trim();
	if (!repoName || !serviceName) {
		return NextResponse.json({ error: "Missing repoName or serviceName" }, { status: 400 });
	}

	const owned = await loadOwnedDeployment(userID, repoName, serviceName);
	if ("error" in owned && owned.error) return owned.error;
	const deployment = owned.deployment!;

	const entries = normalizeEntries(body.entries);
	const region = resolveRegion(deployment, body.region);

	try {
		const { secretsArn } = await upsertDeploymentEnvSecret({
			region,
			userId: userID,
			repoName,
			serviceName,
			entries,
			existingArn: deployment.secretsArn,
		});

		const updateResult = await dbHelper.updateDeployments(
			{
				...deployment,
				secretsArn,
			},
			userID
		);

		if (updateResult.error) {
			const message = typeof updateResult.error === "string" ? updateResult.error : "Failed to save secrets ARN";
			return NextResponse.json({ error: message }, { status: 500 });
		}

		return NextResponse.json({
			ok: true,
			secretsArn,
			entryCount: entries.length,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to save deployment secrets";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
