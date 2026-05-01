import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateContentMock = vi.fn();
const getGenerativeModelMock = vi.fn(() => ({
	generateContent: generateContentMock,
}));
const googleGenerativeAIMock = vi.fn(function GoogleGenerativeAIMock() {
	return {
		getGenerativeModel: getGenerativeModelMock,
	};
});

const bedrockSendMock = vi.fn();
const bedrockCtorConfigs: unknown[] = [];

class InvokeModelCommandMock {
	input: unknown;
	constructor(input: unknown) {
		this.input = input;
	}
}

class BedrockRuntimeClientMock {
	send: typeof bedrockSendMock;
	constructor(config: unknown) {
		bedrockCtorConfigs.push(config);
		this.send = bedrockSendMock;
	}
}

vi.mock("@google/generative-ai", () => ({
	GoogleGenerativeAI: googleGenerativeAIMock,
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
	BedrockRuntimeClient: BedrockRuntimeClientMock,
	InvokeModelCommand: InvokeModelCommandMock,
}));

function makeGeminiResponse(text: string) {
	return {
		response: Promise.resolve({
			text: () => text,
		}),
	};
}

function makeBedrockResponse(text: string) {
	const payload = {
		content: [{ text }],
	};
	return {
		body: new TextEncoder().encode(JSON.stringify(payload)),
	};
}

describe("llmProviders.callLLMWithFallback", () => {
	const originalEnv = { ...process.env };
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		Object.assign(process.env, {
			GEMINI_API_KEY: "",
			GEMINI_MODEL: "",
			BEDROCK_MODEL_ID: "",
			AWS_REGION: "us-west-2",
			AWS_BEDROCK_ACCESS_KEY_ID: "",
			AWS_BEDROCK_SECRET_ACCESS_KEY: "",
			AWS_BEDROCK_SESSION_TOKEN: "",
			AWS_ACCESS_KEY_ID: "",
			AWS_SECRET_ACCESS_KEY: "",
			AWS_SESSION_TOKEN: "",
			AWS_PROFILE: "",
			AWS_WEB_IDENTITY_TOKEN_FILE: "",
			AWS_ROLE_ARN: "",
			LOCAL_LLM_BASE_URL: "",
			LOCAL_LLM_MODEL: "",
		});
		bedrockCtorConfigs.length = 0;
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		vi.unstubAllGlobals();
	});

	it("uses Gemini when available and successful", async () => {
		process.env.GEMINI_API_KEY = "test-key";
		generateContentMock.mockResolvedValue(makeGeminiResponse("gemini-ok"));

		const { callLLMWithFallback } = await import("@/lib/llmProviders");
		const result = await callLLMWithFallback("hello", { maxTokens: 1234 });

		expect(result).toMatchObject({
			text: "gemini-ok",
			provider: "gemini",
			model: "gemini-2.5-flash",
		});
		expect(googleGenerativeAIMock).toHaveBeenCalledWith("test-key");
		expect(getGenerativeModelMock).toHaveBeenCalledWith(
			expect.objectContaining({ model: "gemini-2.5-flash" })
		);
		expect(bedrockSendMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("falls back to Bedrock when Gemini fails", async () => {
		process.env.GEMINI_API_KEY = "test-key";
		process.env.AWS_BEDROCK_ACCESS_KEY_ID = "bedrock-key";
		process.env.AWS_BEDROCK_SECRET_ACCESS_KEY = "bedrock-secret";
		generateContentMock.mockRejectedValue(new Error("gemini down"));
		bedrockSendMock.mockResolvedValue(makeBedrockResponse("bedrock-ok"));

		const { callLLMWithFallback } = await import("@/lib/llmProviders");
		const result = await callLLMWithFallback("hello");

		expect(result).toMatchObject({
			text: "bedrock-ok",
			provider: "bedrock",
		});
		expect(bedrockSendMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("falls back to local when Gemini and Bedrock fail", async () => {
		process.env.GEMINI_API_KEY = "test-key";
		process.env.AWS_BEDROCK_ACCESS_KEY_ID = "bedrock-key";
		process.env.AWS_BEDROCK_SECRET_ACCESS_KEY = "bedrock-secret";
		process.env.LOCAL_LLM_BASE_URL = "http://localhost:11434/api/generate";
		generateContentMock.mockRejectedValue(new Error("gemini down"));
		bedrockSendMock.mockRejectedValue(new Error("bedrock down"));
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ response: "local-ok" }),
		});

		const { callLLMWithFallback } = await import("@/lib/llmProviders");
		const result = await callLLMWithFallback("hello", { localModelDefault: "llama3.2" });

		expect(result).toMatchObject({
			text: "local-ok",
			provider: "local",
			model: "llama3.2",
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("uses Bedrock without explicit keys when AWS_PROFILE is set", async () => {
		process.env.AWS_PROFILE = "dev";
		bedrockSendMock.mockResolvedValue(makeBedrockResponse("bedrock-profile-ok"));

		const { callLLMWithFallback } = await import("@/lib/llmProviders");
		const result = await callLLMWithFallback("hello");

		expect(result).toMatchObject({
			text: "bedrock-profile-ok",
			provider: "bedrock",
		});
		expect(bedrockCtorConfigs[0]).toEqual(expect.objectContaining({ region: "us-west-2" }));
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("uses local directly when only local is configured", async () => {
		process.env.LOCAL_LLM_BASE_URL = "http://localhost:11434/api/generate";
		process.env.LOCAL_LLM_MODEL = "mistral";
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ response: "local-only-ok" }),
		});

		const { callLLMWithFallback } = await import("@/lib/llmProviders");
		const result = await callLLMWithFallback("hello");

		expect(result).toMatchObject({
			text: "local-only-ok",
			provider: "local",
			model: "mistral",
		});
		expect(googleGenerativeAIMock).not.toHaveBeenCalled();
		expect(bedrockSendMock).not.toHaveBeenCalled();
	});

	it("throws when no provider is configured", async () => {
		const { callLLMWithFallback } = await import("@/lib/llmProviders");
		await expect(callLLMWithFallback("hello")).rejects.toThrow("No LLM configured.");
	});
});
