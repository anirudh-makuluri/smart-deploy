import { getApiUrl, readCliToken } from "./auth.js";

type GraphQLError = { message?: unknown };
type GraphQLResponse<T> = { data?: T; errors?: GraphQLError[] };

export async function platformFetch(path: string, init: RequestInit = {}): Promise<Response> {
	const token = await readCliToken();
	if (!token) throw new Error("Not logged in. Run smart-deploy login first.");

	return fetch(`${getApiUrl()}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			...init.headers,
		},
	});
}

export async function platformJson<T>(path: string, init: RequestInit = {}): Promise<T> {
	const response = await platformFetch(path, init);
	const payload = (await response.json().catch(() => ({}))) as { error?: unknown } & T;
	if (!response.ok) {
		const message = typeof payload.error === "string" ? payload.error : `Smart Deploy request failed (${response.status}).`;
		throw new Error(message);
	}
	return payload;
}

export async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
	const payload = await platformJson<GraphQLResponse<T>>("/api/graphql", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ query, variables }),
	});
	const error = payload.errors?.find((candidate) => typeof candidate.message === "string");
	if (typeof error?.message === "string" && error.message) throw new Error(error.message);
	if (!payload.data) throw new Error("Smart Deploy returned no data.");
	return payload.data;
}
