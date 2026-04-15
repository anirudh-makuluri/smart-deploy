import { NextResponse } from "next/server";
import { getRepoFilePaths } from "@/github-helper";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getGithubAccessTokenForUserId } from "@/lib/githubAccessToken";

export async function POST(req: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	const userId = session?.user?.id;
	const token = userId ? await getGithubAccessTokenForUserId(userId, req.headers) : null;

	if (!token) {
		return NextResponse.json({ error: "GitHub not connected" }, { status: 401 });
	}

	const body = await req.json();
	const { full_name, branch, target_workdir } = body;
	let { include_extra_info } = body;

	if (include_extra_info === undefined) include_extra_info = false;

	const { filePaths, fileContents } = await getRepoFilePaths(full_name, branch, token);
	const prompt = createPrompt(filePaths, fileContents, include_extra_info, target_workdir);

	try {
		const text = await callLLMWithFallback(prompt);
		return NextResponse.json({ response: text, filePaths, fileContents });
	} catch (error: unknown) {
		console.error("LLM error (Gemini and local fallback failed):", error);
		return NextResponse.json(
			{
				error: "LLM request failed",
				details: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 502 }
		);
	}
}

/** Try Gemini first; if it fails, run the same prompt on the local LLM. */
async function callLLMWithFallback(prompt: string): Promise<string> {
	const hasGemini = !!process.env.GEMINI_API_KEY?.trim();
	const hasLocal = !!process.env.LOCAL_LLM_BASE_URL?.trim();

	if (hasGemini) {
		try {
			return await callGemini(prompt);
		} catch (geminiError) {
			console.warn("Gemini failed, falling back to local LLM:", geminiError);
			if (hasLocal) {
				return await callLocalLLM(prompt);
			}
			throw geminiError;
		}
	}
	if (hasLocal) {
		return await callLocalLLM(prompt);
	}
	throw new Error("No LLM configured. Set GEMINI_API_KEY and/or LOCAL_LLM_BASE_URL.");
}

async function callBedrock(prompt: string): Promise<string> {
	console.log("Calling Bedrock API");
	const region = process.env.AWS_REGION || "us-west-2";
	const accessKeyId = process.env.AWS_BEDROCK_ACCESS_KEY_ID;
	const secretAccessKey = process.env.AWS_BEDROCK_SECRET_ACCESS_KEY;

	if (!accessKeyId || !secretAccessKey) {
		throw new Error("Missing AWS credentials (AWS_BEDROCK_ACCESS_KEY_ID and AWS_BEDROCK_SECRET_ACCESS_KEY required when NODE_ENV=prod)");
	}

	const client = new BedrockRuntimeClient({
		region,
		credentials: {
			accessKeyId,
			secretAccessKey,
		},
	});

	// Claude Opus 4.5 model ID on Bedrock
	// Default model ID - can be overridden via BEDROCK_MODEL_ID env var
	// Common formats: "anthropic.claude-opus-4-5-v1:0" or check AWS Bedrock console for exact ID
	const modelId = process.env.BEDROCK_MODEL_ID || "anthropic.claude-opus-4-5-v1:0";

	const command = new InvokeModelCommand({
		modelId,
		contentType: "application/json",
		accept: "application/json",
		body: JSON.stringify({
			anthropic_version: "bedrock-2023-05-31",
			max_tokens: 8192,
			temperature: 0.2,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: prompt,
						},
					],
				},
			],
		}),
	});

	const response = await client.send(command);
	const responseBody = JSON.parse(new TextDecoder().decode(response.body));

	if (!responseBody.content || !responseBody.content[0]?.text) {
		throw new Error("Invalid response from Bedrock API");
	}

	console.log("Bedrock response:", responseBody.content[0].text);

	return responseBody.content[0].text;
}

async function callGemini(prompt: string): Promise<string> {
	const geminiApiKey = process.env.GEMINI_API_KEY;
	if (!geminiApiKey?.trim()) {
		throw new Error("Missing GEMINI_API_KEY env var");
	}
	const genAI = new GoogleGenerativeAI(geminiApiKey);
	const model = genAI.getGenerativeModel({
		model: "gemini-2.5-flash",
		generationConfig: {
			temperature: 0.2,
			maxOutputTokens: 8192,
		},
	});
	const result = await model.generateContent(prompt);
	const response = await result.response;
	return response.text();
}

async function callLocalLLM(prompt: string): Promise<string> {
	const baseUrl = process.env.LOCAL_LLM_BASE_URL || "";
	if (!baseUrl?.trim()) {
		throw new Error("Missing LOCAL_LLM_BASE_URL env var");
	}
	const model = process.env.LOCAL_LLM_MODEL || "mistral";
	let res: Response;
	try {
		res = await fetch(baseUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				prompt: prompt,
				stream: false,
				temperature: 0.2,
				max_tokens: 8192,
			}),
		});
	} catch (err: unknown) {
		const cause = err instanceof Error && "cause" in err ? (err.cause as NodeJS.ErrnoException) : null;
		if (cause?.code === "ECONNREFUSED") {
			throw new Error(
				`Local LLM server unreachable at ${baseUrl}. Is Ollama or your LLM server running? (ECONNREFUSED)`
			);
		}
		throw err;
	}
	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`Local LLM returned ${res.status}: ${errText.slice(0, 200)}`);
	}
	const data = await res.json();
	const text = data.response as string;
	console.log("Local LLM response:", text);

	if (text == null) {
		throw new Error("Local LLM response missing text");
	}
	return text;
}


function createPrompt(filePaths: string[], fileContents: Record<string, string>, include_extra_info: boolean, target_workdir?: string) {
	const targetDirInstruction = target_workdir ?
		`\n\nCRITICAL CONTEXT FOR SINGLE SERVICE DIRECTORY:\nThe user is deploying a specific service located at "${target_workdir}". You MUST analyze ONLY the code and configuration within this directory, ignoring the rest of the monorepo root (unless standard workspace files like package.json or lockfiles are needed for global context of how it runs). DO NOT return deployment data for the monorepo root; you MUST output the framework, language, and run commands relating SPECIFICALLY to the service at "${target_workdir}". `
		: "";

	const prompt = `Analyze this repo for deployment.${targetDirInstruction}

Output rules: Return ONLY a single JSON object. No text, explanation, or markdown before or after. No code fences (\`\`\`). No comments inside the JSON (no // or /* */). No trailing commas. The response must be parseable by JSON.parse().

Repository file list:
${filePaths.join("\n")}

File contents:
${Object.entries(fileContents)
			.map(([file, content]) => `\n--- ${file} ---\n${content}`)
			.join("\n")}

Required JSON keys:
  IMPORTANT: If the repo has NO deployable code (empty, only docs/README, only config files, only mobile code with no backend), set language to null or empty string, and run_cmd to null.
${target_workdir ?
			`  IMPORTANT FOR THIS SERVICE: Even though this is a monorepo, analyze strictly the service at "${target_workdir}".`
			:
			`  IMPORTANT FOR MONOREPOS: If the repo is a monorepo (has pnpm-workspace.yaml, workspaces in package.json, turbo.json, nx.json, or lerna.json), individual service details should go in monorepo_services.`}
${include_extra_info ? `
- features_infrastructure: { uses_websockets, uses_cron, uses_mobile, uses_server, is_library, cloud_run_compatible, requires_build_but_missing_cmd } (all boolean; cloud_run_compatible = true only if stateless HTTP, no long-lived WebSockets, no mobile/lib)
  IMPORTANT: 
  - Set uses_mobile=true ONLY if the repo contains mobile code (React Native, Flutter, iOS, Android). 
  - Set uses_server=true ONLY if there's actual server/backend code that runs on a server (Express, FastAPI, Django, Flask, NestJS, etc.). Next.js with server-side rendering is a server-based framework, so uses_server=true for full Next.js apps.
  - Static SPAs (Create React App, Vite, Angular, Vue CLI, Svelte) have uses_server=false because they are client-side only and don't need a server runtime.
  - Firebase, Supabase client SDKs, and other BaaS (Backend-as-a-Service) clients are NOT server code - they run in the browser. Static SPAs using Firebase/Supabase should have uses_server=false.
  - If mobile-only with no server code, set uses_mobile=true and uses_server=false.
  - If mobile-only with no server code, set uses_mobile=true and uses_server=false.
- deployment_hints: { has_dockerfile (boolean), is_multi_service (boolean), is_monorepo (boolean), has_database (boolean), nextjs_static_export (boolean; true only if Next.js and next.config has output: "export") }
  IMPORTANT: is_monorepo = true if the repo uses workspace tooling (pnpm-workspace.yaml, npm/yarn workspaces in package.json, turbo.json, nx.json, or lerna.json) with multiple apps/services in subdirectories (apps/, packages/, services/). A monorepo is automatically is_multi_service=true if it has 2+ deployable services. Mobile-only packages (React Native, Expo, Flutter) should NOT count as deployable services.
- monorepo_services: (array, only if is_monorepo=true, otherwise omit or set to []) Each entry: { name (string), path (relative path e.g. "apps/web"), language (e.g. "TypeScript"), framework (e.g. "Next.js", "Express"), port (number or null), is_deployable (boolean - false for mobile-only, shared libs, config packages) }
  For each workspace package/app, identify if it's a deployable server-side service. Skip shared library packages (e.g. packages/config, packages/eslint-config) and mobile-only packages.
  - ec2: true for complex apps requiring full OS-level control, custom infrastructure, or when other platforms don't fit (NOT a fallback for mobile-only or empty repos)
  - cloud_run: true only if stateless HTTP service, no long-lived WebSockets, not mobile/lib; same as cloud_run_compatible
  IMPORTANT: If the repo contains ONLY mobile code (React Native, Flutter, iOS, Android) with no server/backend, set ALL platforms to false. If the repo has no deployable code (empty, docs-only, etc.), set ALL platforms to false.
  Prefer the simplest compatible platform.
- final_notes: { comment (1–2 sentences on structure and deploy readiness) }` : ""}
`;
	return prompt;
}
