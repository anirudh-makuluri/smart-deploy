function analysisText(value: unknown, includeResponse: boolean): string {
	if (!value || typeof value !== "object" || Array.isArray(value)) return "Analysis failed.";
	const fields = includeResponse ? ["response", "error", "details"] : ["error", "details"];
	for (const field of fields) {
		const text = (value as Record<string, unknown>)[field];
		if (typeof text === "string" && text) return text;
	}
	return "Analysis failed.";
}

export async function requestFailureAnalysis(runId: string): Promise<string> {
	const response = await fetch("/api/llm/analyze-failure", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ runId }),
	});
	if (!response.ok) {
		const error: unknown = await response.json().catch(() => null);
		throw new Error(analysisText(error, false));
	}
	const data: unknown = await response.json().catch(() => null);
	return analysisText(data, true);
}
