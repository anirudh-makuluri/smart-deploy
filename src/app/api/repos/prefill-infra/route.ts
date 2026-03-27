import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import fs from "fs";
import os from "os";
import path from "path";
import { authOptions } from "@/app/api/auth/authOptions";
import {
	fetchRepoMetadata,
	GithubApiError,
	parseGithubOwnerRepo,
	prepareGithubRepoWorkspace,
} from "@/lib/githubRepoArchive";
import { buildPrefilledScanResults } from "@/lib/infrastructurePrefill";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redactTokenInText(text: string, token: string): string {
	if (!token) return text;
	return text.split(token).join("[REDACTED]");
}

export async function POST(req: NextRequest) {
	try {
		const session = await getServerSession(authOptions);
		const token = session?.accessToken;
		if (!token) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await req.json();
		const url = typeof body.url === "string" ? body.url.trim() : "";
		const packagePath = typeof body.package_path === "string" ? body.package_path.trim() : "";
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

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prefill-infra-"));

		try {
			if (!branch) {
				const { default_branch } = await fetchRepoMetadata(parsed.owner, parsed.repo, token);
				branch = default_branch;
			}

			const { repoRoot, effectiveBranch } = await prepareGithubRepoWorkspace(parsed.owner, parsed.repo, branch, token, tmpDir);
			const results = buildPrefilledScanResults(repoRoot, packagePath);

			if (!results) {
				return NextResponse.json({ found: false, branch: effectiveBranch });
			}

			return NextResponse.json({
				found: true,
				branch: effectiveBranch,
				results,
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
		console.error("prefill-infra error:", err);
		return NextResponse.json(
			{ error: err instanceof Error ? err.message : "Prefill infrastructure failed" },
			{ status: 500 }
		);
	}
}
