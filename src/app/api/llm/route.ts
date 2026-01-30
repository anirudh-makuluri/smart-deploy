import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "../auth/authOptions";
import { getRepoFilePaths } from "@/github-helper";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: Request) {
	const session = await getServerSession(authOptions);

	const token = session?.accessToken;

	if (!token) {
		return NextResponse.json({ error: "Missing access token" }, { status: 401 });
	}

	const body = await req.json();
	let { full_name, branch, include_extra_info } = body;

	if (include_extra_info === undefined) include_extra_info = false;

	const { filePaths, fileContents } = await getRepoFilePaths(full_name, branch, token);
	const prompt = createPrompt(filePaths, fileContents, include_extra_info);

	const nodeEnv = process.env.ENVIRONMENT as string | undefined;
	const isProd = nodeEnv == "production";

	try {
		const text = isProd ? await callGemini(prompt) : await callLocalLLM(prompt);
		return NextResponse.json({ response: text, filePaths, fileContents });
	} catch (error: any) {
		console.error(isProd ? "Bedrock API error:" : "Local LLM error:", error);
		return NextResponse.json(
			{
				error: isProd ? "Bedrock API request failed" : "Local LLM request failed",
				details: error?.message || "Unknown error",
			},
			{ status: 502 }
		);
	}
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
	if (!geminiApiKey) {
		throw new Error("Missing GEMINI_API_KEY env var (required when NODE_ENV=prod)");
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

/** Calls a local LLM via OpenAI-compatible API (e.g. Ollama, LM Studio, llama.cpp server). */
async function callLocalLLM(prompt: string): Promise<string> {
	const baseUrl = process.env.LOCAL_LLM_BASE_URL || "";
	if (!baseUrl) {
		throw new Error("Missing LOCAL_LLM_BASE_URL env var (required when NODE_ENV=local)");
	}
	const model = process.env.LOCAL_LLM_MODEL || "llama3.2";
	const res = await fetch(baseUrl, {
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


function createPrompt(filePaths: string[], fileContents: Record<string, string>, include_extra_info: boolean) {
	const prompt = `Analyze this repo for deployment. Return only valid JSON (no markdown, no trailing commas).

Repository file list:
${filePaths.join("\n")}

File contents:
${Object.entries(fileContents)
		.map(([file, content]) => `\n--- ${file} ---\n${content}`)
		.join("\n")}

Required JSON keys:
- core_deployment_info: { language (e.g. TypeScript, Python), framework (e.g. Next.js, Express), install_cmd, build_cmd (string or null), run_cmd, workdir (string or null) }
${include_extra_info ? `
- features_infrastructure: { uses_websockets, uses_cron, uses_mobile, uses_server, is_library, requires_build_but_missing_cmd } (all boolean)
- deployment_hints: { has_dockerfile (boolean, true if repo root or app dir has Dockerfile), is_multi_service (true if multiple deployable services), has_database (true if app uses PostgreSQL/MySQL/Mongo etc), nextjs_static_export (true only if Next.js and next.config has output: "export") }
- final_notes: { comment (1–2 sentences on structure and deploy readiness) }` : ""}
`;
	return prompt;
}
