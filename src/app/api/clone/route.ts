// app/api/clone/route.ts
import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
	const { repoUrl, repoName } = await req.json();
	const authHeader = req.headers.get("authorization");
	const token = authHeader?.split(" ")[1];

	if (!repoUrl || !token) {
		return NextResponse.json({ message: "Missing repo or token" }, { status: 400 });
	}

	// Create temp dir
	const repoDir = path.join(process.cwd(), "clones", repoName);

	const authenticatedUrl = repoUrl.replace("https://", `https://${token}@`);

	try {
		await execAsync(`git clone ${authenticatedUrl} ${repoDir}`);
		return NextResponse.json({ message: `Repo cloned to ${repoDir}` });
	} catch (err: any) {
		return NextResponse.json({ message: `Clone failed: ${err.message}` }, { status: 500 });
	}
}
