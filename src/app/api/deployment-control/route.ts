import { NextRequest, NextResponse } from "next/server";
import { runCommandLiveWithOutput } from "@/server-helper";
import config from "@/config";

export async function PUT(req: NextRequest) {
	try {
		const { serviceName, action } = await req.json();

		if (!serviceName || !action) {
			return NextResponse.json({ error: "Missing service name or action" }, { status: 400 });
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

		// Run the command
		const output = await runCommandLiveWithOutput("gcloud", args);
		return NextResponse.json({ success: true, output });

	} catch (err: any) {
		console.error("Service control error:", err);
		return NextResponse.json({ error: err.message }, { status: 500 });
	}
}
