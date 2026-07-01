import { AgentResponseSchema, type AgentLlmResponse } from "@/lib/deploymentAgent/agentSchemas";
import { JSON_FENCE_REGEX } from "@/lib/deploymentAgent/constants";

function extractBalancedJsonObject(raw: string): string | null {
	const start = raw.indexOf("{");
	if (start === -1) {
		return null;
	}

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let index = start; index < raw.length; index += 1) {
		const character = raw[index];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === "\\") {
				escaped = true;
				continue;
			}
			if (character === '"') {
				inString = false;
			}
			continue;
		}

		if (character === '"') {
			inString = true;
			continue;
		}
		if (character === "{") {
			depth += 1;
			continue;
		}
		if (character === "}") {
			depth -= 1;
			if (depth === 0) {
				return raw.slice(start, index + 1);
			}
		}
	}

	return null;
}

function candidateJsonStrings(raw: string): string[] {
	const trimmed = raw.trim();
	const candidates: string[] = [];
	const seen = new Set<string>();

	const addCandidate = (value: string | null | undefined) => {
		const candidate = value?.trim();
		if (!candidate || seen.has(candidate)) {
			return;
		}
		seen.add(candidate);
		candidates.push(candidate);
	};

	const fenced = JSON_FENCE_REGEX.exec(trimmed);
	addCandidate(fenced?.[1]);
	addCandidate(extractBalancedJsonObject(trimmed));
	addCandidate(trimmed);

	return candidates;
}

export function parseAgentResponseJson(raw: string): AgentLlmResponse | null {
	for (const candidate of candidateJsonStrings(raw)) {
		try {
			const parsed = JSON.parse(candidate) as unknown;
			return AgentResponseSchema.parse(parsed);
		} catch {
			continue;
		}
	}

	return null;
}