import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import fs from "fs";
import os from "os";
import path from "path";
import { detectMultiService, ServiceDefinition } from "@/lib/multiServiceDetector";
import { authOptions } from "@/app/api/auth/authOptions";
import { dbHelper } from "@/db-helper";
import type { DetectedServiceInfo } from "@/app/types";
import {
	fetchRepoMetadata,
	GithubApiError,
	parseGithubOwnerRepo,
	prepareGithubRepoWorkspace,
} from "@/lib/githubRepoArchive";
import { findDemoRepoConfig } from "../../../../lib/demoMode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toDetectedService(s: ServiceDefinition, repoRoot: string, cloneDir: string): DetectedServiceInfo {
	const pathRel = s.relativePath ?? (path.isAbsolute(s.workdir) ? path.relative(repoRoot, s.workdir).replace(/\\/g, "/") : s.workdir.replace(/\\/g, "/"));
	return {
		name: s.name,
		path: pathRel,
		language: s.language || "",
		framework: s.framework,
		port: s.port,
	};
}

function redactTokenInText(text: string, token: string): string {
	if (!token) return text;
	return text.split(token).join("[REDACTED]");
}

export async function POST(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const token = session?.accessToken;
		const accountMode = session?.accountMode ?? "demo";
		if (!token) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await req.json();
		const url = typeof body.url === "string" ? body.url.trim() : "";
		let branch = typeof body.branch === "string" ? body.branch.trim() : "";

		if (!url) {
			return NextResponse.json({ error: "Missing url" }, { status: 400 });
		}

		let repoUrl = url.replace(/\.git$/, "");
		if (!repoUrl.startsWith("http")) {
			repoUrl = repoUrl.includes("/") ? `https://github.com/${repoUrl}` : "";
		}
		if (!repoUrl || !repoUrl.includes("github.com")) {
			return NextResponse.json({ error: "Invalid repository URL" }, { status: 400 });
		}

		const parsed = parseGithubOwnerRepo(repoUrl);
		if (!parsed) {
			return NextResponse.json({ error: "Could not parse GitHub owner/repo from URL" }, { status: 400 });
		}

		const { owner, repo } = parsed;
		const demoRepo = accountMode === "demo" ? findDemoRepoConfig({ owner, repo, url: repoUrl }) : null;
		if (accountMode === "demo" && !demoRepo) {
			return NextResponse.json({ error: "Demo users can only scan the curated demo repositories." }, { status: 403 });
		}
		if (demoRepo?.scan_results?.services?.length) {
			const services: DetectedServiceInfo[] = demoRepo.scan_results.services.map((svc) => ({
				name: svc.name,
				path: svc.build_context || ".",
				language: svc.language || "",
				framework: svc.framework,
				port: svc.port,
			}));
			const userID = (session as { userID?: string })?.userID;
			if (userID) {
				await dbHelper.upsertRepoServices(userID, repoUrl, {
					branch: demoRepo.branch,
					repo_owner: owner,
					repo_name: repo,
					services,
					is_monorepo: services.length > 1,
				});
			}
			return NextResponse.json({
				isMonorepo: services.length > 1,
				isMultiService: services.length > 1,
				services,
			});
		}
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-services-"));

		try {
			if (!branch) {
				const { default_branch } = await fetchRepoMetadata(owner, repo, token);
				branch = default_branch;
			}
			const { repoRoot, effectiveBranch } = await prepareGithubRepoWorkspace(owner, repo, branch, token, tmpDir);

			const multiServiceConfig = detectMultiService(repoRoot);

			const services: DetectedServiceInfo[] =
				multiServiceConfig.services.length > 0
					? multiServiceConfig.services.map((s) => toDetectedService(s, repoRoot, repoRoot))
					: [{ name: "app", path: ".", language: "node", port: 3000 }];

			const userID = (session as { userID?: string })?.userID;
			if (userID) {
				await dbHelper.upsertRepoServices(userID, repoUrl, {
					branch: effectiveBranch,
					repo_owner: owner,
					repo_name: repo,
					services,
					is_monorepo: multiServiceConfig.isMonorepo ?? false,
				});
			}

			return NextResponse.json({
				isMonorepo: multiServiceConfig.isMonorepo,
				isMultiService: multiServiceConfig.isMultiService,
				services,
				packageManager: multiServiceConfig.packageManager ?? undefined,
			});
		} catch (inner: unknown) {
			if (inner instanceof GithubApiError) {
				const details = redactTokenInText(inner.message, token);
				const status = inner.status === 404 ? 404 : 502;
				return NextResponse.json(
					{ error: "Failed to fetch repository from GitHub", details },
					{ status }
				);
			}
			throw inner;
		} finally {
			try {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			} catch {
				// ignore cleanup errors
			}
		}
	} catch (err: unknown) {
		console.error("detect-services error:", err);
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Detect services failed" },
			{ status: 500 }
		);
	}
}
