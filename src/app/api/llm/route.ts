import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../auth/[...nextauth]/route";
import { getRepoFilePaths } from "@/github-helper";

export async function POST(req: Request) {
	const session = await getServerSession(authOptions);

	const token = session?.accessToken

	if (!token) {
		return NextResponse.json({ error: "Missing access token" }, { status: 401 });
	}

	const body = await req.json();
	let { full_name, branch, include_extra_info } = body;

	if(!include_extra_info) include_extra_info = false;

	const { filePaths, fileContents } = await getRepoFilePaths(full_name, branch, token);
	const prompt = createPrompt(filePaths, fileContents, include_extra_info);

	const OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
	console.log("Sending req to " + OLLAMA_URL)
	const response = await fetch(OLLAMA_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "mistral",
			prompt: prompt,
			stream: false,
		}),
	});

	const data = await response.json();

	return NextResponse.json({ response: data.response, filePaths, fileContents });
}


function createPrompt(filePaths: string[], fileContents: Record<string, string>, include_extra_info : boolean) {
	const prompt = `
You are an expert DevOps and full-stack code assistant. I have a GitHub repository that I want to deploy using Cloud Run.

Here is the list of all files in the repository:
${filePaths.join("\n")}

Here are the contents of some important files:
${Object.entries(fileContents)
			.map(([file, content]) => `\n---\n📄 ${file}:\n${content}`)
			.join("\n")}

Please analyze this project and return a strict JSON object with the following keys:

-------------

core_deployment_info:
- language: The main programming language used
- framework: The web or application framework (e.g., Express, Next.js, Django)
- install_cmd: Command to install dependencies (e.g., "npm install")
- build_cmd: Command to build the project (or null if none)
- run_cmd: Command to start the application
- workdir: The subdirectory (if any) that contains the main app


${include_extra_info ? extraInfo : ""}

-------------

⚠️ VERY IMPORTANT:
- Respond in **strict JSON format**
- No markdown, no explanations, no comments
- Do not include trailing commas or extra text
`;


	return prompt

}

const extraInfo = `

---

features_infrastructure:
- uses_websockets: true/false
- uses_cron: true/false
- uses_mobile: true/false
- uses_server: true/false
- cloud_run_compatible: true/false
- is_library: true/false
- requires_build_but_missing_cmd: true/false

---

final_notes:
- comment: A short, professional opinion (1–2 sentences) about the structure, quality, and deployment readiness of the project.

`
