import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { GoogleGenerativeAI } from "@google/generative-ai";

export type LLMProvider = "gemini" | "bedrock" | "local";

export type LLMFallbackResult = {
	text: string;
	model: string;
	provider: LLMProvider;
};

export type LLMFallbackOptions = {
	temperature?: number;
	maxTokens?: number;
	geminiModel?: string;
	bedrockModelId?: string;
	localModelDefault?: string;
	localTimeoutMs?: number;
	contextLabel?: string;
};

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_BEDROCK_MODEL = "anthropic.claude-haiku-4-5-20251001-v1:0";

export async function callLLMWithFallback(
	prompt: string,
	options: LLMFallbackOptions = {}
): Promise<LLMFallbackResult> {
	const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
	const hasBedrock = hasBedrockCredentialsOrContext();
	const hasLocal = Boolean(process.env.LOCAL_LLM_BASE_URL?.trim());
	const contextLabel = options.contextLabel ?? "LLM";

	if (hasGemini) {
		try {
			return await callGemini(prompt, options);
		} catch (geminiError) {
			console.warn(`${contextLabel}: Gemini failed, attempting Bedrock/local fallback`, geminiError);
			let bedrockError: unknown;
			if (hasBedrock) {
				try {
					return await callBedrock(prompt, options);
				} catch (error) {
					bedrockError = error;
					console.warn(`${contextLabel}: Bedrock fallback failed, attempting local fallback`, error);
				}
			}
			if (hasLocal) return callLocalLLM(prompt, options);
			if (bedrockError) {
				throw new Error(
					`Gemini failed: ${errorToMessage(geminiError)} | Bedrock failed: ${errorToMessage(bedrockError)}`
				);
			}
			throw geminiError;
		}
	}

	if (hasBedrock) {
		try {
			return await callBedrock(prompt, options);
		} catch (bedrockError) {
			console.warn(`${contextLabel}: Bedrock failed, attempting local fallback`, bedrockError);
			if (hasLocal) return callLocalLLM(prompt, options);
			throw bedrockError;
		}
	}

	if (hasLocal) return callLocalLLM(prompt, options);

	throw new Error(
		"No LLM configured. Set GEMINI_API_KEY and/or AWS_BEDROCK_ACCESS_KEY_ID + AWS_BEDROCK_SECRET_ACCESS_KEY and/or LOCAL_LLM_BASE_URL."
	);
}

function hasBedrockCredentialsOrContext(): boolean {
	return Boolean(
		(process.env.AWS_BEDROCK_ACCESS_KEY_ID?.trim() &&
			process.env.AWS_BEDROCK_SECRET_ACCESS_KEY?.trim()) ||
			(process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim()) ||
			process.env.AWS_PROFILE?.trim() ||
			(process.env.AWS_WEB_IDENTITY_TOKEN_FILE?.trim() && process.env.AWS_ROLE_ARN?.trim())
	);
}

async function callGemini(prompt: string, options: LLMFallbackOptions): Promise<LLMFallbackResult> {
	const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
	if (!geminiApiKey) {
		throw new Error("Missing GEMINI_API_KEY env var");
	}

	const modelName = options.geminiModel?.trim() || process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
	const genAI = new GoogleGenerativeAI(geminiApiKey);
	const model = genAI.getGenerativeModel({
		model: modelName,
		generationConfig: {
			temperature: options.temperature ?? 0.2,
			maxOutputTokens: options.maxTokens ?? 4096,
		},
	});

	const result = await model.generateContent(prompt);
	const response = await result.response;
	return {
		text: response.text(),
		model: modelName,
		provider: "gemini",
	};
}

async function callBedrock(prompt: string, options: LLMFallbackOptions): Promise<LLMFallbackResult> {
	const region = process.env.AWS_REGION || "us-west-2";
	const modelId = options.bedrockModelId?.trim() || process.env.BEDROCK_MODEL_ID?.trim() || DEFAULT_BEDROCK_MODEL;
	const client = createBedrockClient(region);

	const command = new InvokeModelCommand({
		modelId,
		contentType: "application/json",
		accept: "application/json",
		body: JSON.stringify({
			anthropic_version: "bedrock-2023-05-31",
			max_tokens: options.maxTokens ?? 4096,
			temperature: options.temperature ?? 0.2,
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
	const text = responseBody?.content?.[0]?.text;

	if (typeof text !== "string" || !text.trim()) {
		throw new Error("Invalid response from Bedrock API");
	}

	return {
		text,
		model: modelId,
		provider: "bedrock",
	};
}

function createBedrockClient(region: string): BedrockRuntimeClient {
	const explicitBedrockAccessKey = process.env.AWS_BEDROCK_ACCESS_KEY_ID?.trim();
	const explicitBedrockSecretKey = process.env.AWS_BEDROCK_SECRET_ACCESS_KEY?.trim();
	const genericAccessKey = process.env.AWS_ACCESS_KEY_ID?.trim();
	const genericSecretKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
	const sessionToken =
		process.env.AWS_BEDROCK_SESSION_TOKEN?.trim() || process.env.AWS_SESSION_TOKEN?.trim();

	if (explicitBedrockAccessKey && explicitBedrockSecretKey) {
		return new BedrockRuntimeClient({
			region,
			credentials: {
				accessKeyId: explicitBedrockAccessKey,
				secretAccessKey: explicitBedrockSecretKey,
				...(sessionToken ? { sessionToken } : {}),
			},
		});
	}

	if (genericAccessKey && genericSecretKey) {
		return new BedrockRuntimeClient({
			region,
			credentials: {
				accessKeyId: genericAccessKey,
				secretAccessKey: genericSecretKey,
				...(sessionToken ? { sessionToken } : {}),
			},
		});
	}

	return new BedrockRuntimeClient({ region });
}

async function callLocalLLM(prompt: string, options: LLMFallbackOptions): Promise<LLMFallbackResult> {
	const baseUrl = process.env.LOCAL_LLM_BASE_URL?.trim();
	if (!baseUrl) {
		throw new Error("Missing LOCAL_LLM_BASE_URL env var");
	}
	const model = process.env.LOCAL_LLM_MODEL || options.localModelDefault || "mistral";
	const controller = options.localTimeoutMs && options.localTimeoutMs > 0 ? new AbortController() : null;
	const timeout =
		controller && options.localTimeoutMs
			? setTimeout(() => controller.abort(), options.localTimeoutMs)
			: null;

	let res: Response;
	try {
		res = await fetch(baseUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			...(controller ? { signal: controller.signal } : {}),
			body: JSON.stringify({
				model,
				prompt,
				stream: false,
				temperature: options.temperature ?? 0.2,
				max_tokens: options.maxTokens ?? 4096,
			}),
		});
	} catch (error) {
		const cause =
			error instanceof Error && "cause" in error ? (error.cause as NodeJS.ErrnoException) : null;
		if (cause?.code === "ECONNREFUSED") {
			throw new Error(
				`Local LLM server unreachable at ${baseUrl}. Is Ollama or your LLM server running? (ECONNREFUSED)`
			);
		}
		throw error;
	} finally {
		if (timeout) clearTimeout(timeout);
	}

	if (!res.ok) {
		const errText = await res.text();
		throw new Error(`Local LLM returned ${res.status}: ${errText.slice(0, 200)}`);
	}

	const data = (await res.json()) as { response?: string };
	if (!data.response) throw new Error("Local LLM response missing text");

	return {
		text: data.response,
		model,
		provider: "local",
	};
}

function errorToMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
