import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { detectMultiService, ServiceDefinition } from "@/lib/multiServiceDetector";
import { authOptions } from "@/app/api/auth/authOptions";
import { dbHelper } from "@/db-helper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Serializable service shape for the UI (no absolute paths) */
export type DetectedService = {
	name: string;
	path: string;
	language?: string;
	framework?: string;
	port?: number;
};

function toDetectedService(s: ServiceDefinition, repoRoot: string): DetectedService {
	const pathRel = s.relativePath ?? (path.isAbsolute(s.workdir) ? path.relative(repoRoot, s.workdir).replace(/\\/g, "/") : s.workdir.replace(/\\/g, "/"));
	return {
		name: s.name,
		path: pathRel,
		language: s.language,
		framework: s.framework,
		port: s.port,
	};
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
		const branch = typeof body.branch === "string" ? body.branch.trim() || "main" : "main";

		if (!url) {
			return NextResponse.json({ error: "Missing url" }, { status: 400 });
		}

		// Normalize to https GitHub URL for clone
		let repoUrl = url.replace(/\.git$/, "");
		if (!repoUrl.startsWith("http")) {
			repoUrl = repoUrl.includes("/") ? `https://github.com/${repoUrl}` : "";
		}
		if (!repoUrl || !repoUrl.includes("github.com")) {
			return NextResponse.json({ error: "Invalid repository URL" }, { status: 400 });
		}

		const repoName = repoUrl.split("/").filter(Boolean).pop() || "repo";
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-services-"));
		const cloneDir = path.join(tmpDir, repoName);
		const authenticatedUrl = repoUrl.replace("https://", `https://${token}@`);

		try {
			const result = spawnSync("git", ["clone", "--depth", "1", "-b", branch, authenticatedUrl, cloneDir], {
				stdio: "pipe",
				encoding: "utf-8",
				shell: process.platform === "win32",
			});

			if (result.status !== 0) {
				const stderr = result.stderr || result.error?.message || "";
				// Don't leak token in error
				return NextResponse.json(
					{ error: "Clone failed", details: stderr.replace(new RegExp(token, "g"), "[REDACTED]") },
					{ status: 502 }
				);
			}

			const multiServiceConfig = detectMultiService(cloneDir);

			// If single-service repo, still return one "service" for consistent UI
			const services: DetectedService[] =
				multiServiceConfig.services.length > 0
					? multiServiceConfig.services.map((s) => toDetectedService(s, cloneDir))
					: [{ name: "app", path: ".", language: "node", port: 3000 }];

			// Persist to DB for this user
			const userID = (session as { userID?: string })?.userID;
			if (userID) {
				const parts = repoUrl.replace(/\.git$/, "").split("/").filter(Boolean);
				const repoNameFromUrl = parts.pop() || "repo";
				const repoOwnerFromUrl = parts.pop() || "unknown";
				await dbHelper.upsertRepoServices(userID, repoUrl, {
					branch,
					repo_owner: repoOwnerFromUrl,
					repo_name: repoNameFromUrl,
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
