import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildVerificationCandidates,
	fetchWithTimeout,
	isSuccessfulVerificationStatus,
	probeDeploymentHealth,
} from "@/lib/deploymentHealthProbe";

function requestUrl(input: Parameters<typeof fetch>[0]): URL {
	if (typeof input === "string") return new URL(input);
	if (input instanceof URL) return input;
	return new URL(input.url);
}

type FetchMock = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;

describe("deploymentHealthProbe", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("builds root-first candidates for hosted apps", () => {
		expect(buildVerificationCandidates("https://lexiguess-next19u2m.smart-deploy.xyz/")).toEqual([
			"https://lexiguess-next19u2m.smart-deploy.xyz/",
			"https://lexiguess-next19u2m.smart-deploy.xyz/health",
			"https://lexiguess-next19u2m.smart-deploy.xyz/healthz",
			"https://lexiguess-next19u2m.smart-deploy.xyz/api/health",
		]);
	});

	it("treats only 2xx and 3xx responses as verification success", () => {
		expect(isSuccessfulVerificationStatus(200)).toBe(true);
		expect(isSuccessfulVerificationStatus(302)).toBe(true);
		expect(isSuccessfulVerificationStatus(404)).toBe(false);
		expect(isSuccessfulVerificationStatus(500)).toBe(false);
	});

	it("verifies an SPA from / when health endpoints are missing", async () => {
		const fetchMock = vi.fn<FetchMock>(async (input) => {
			const url = requestUrl(input);
			const status = url.pathname === "/" ? 200 : 404;
			return new Response(status === 200 ? "<html>ok</html>" : "missing", { status });
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await probeDeploymentHealth("https://spa.example.com", 1_000);

		expect(result).toMatchObject({
			reachable: true,
			checkedUrl: "https://spa.example.com/",
			httpStatus: 200,
		});
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it("does not mark missing health endpoints as reachable by themselves", async () => {
		const fetchMock = vi.fn<FetchMock>(async () => new Response("missing", { status: 404 }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await probeDeploymentHealth("https://missing.example.com", 1_000);

		expect(result).toMatchObject({
			reachable: false,
			httpStatus: 404,
		});
	});

	it("sends health probes with browser-compatible request headers", async () => {
		const fetchMock = vi.fn<FetchMock>(async () => new Response("ok", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await fetchWithTimeout("https://spa.example.com/", 1_000);

		const init = fetchMock.mock.calls[0]?.[1];
		const headers = new Headers(init?.headers);
		expect(init?.method).toBe("GET");
		expect(init?.redirect).toBe("follow");
		expect(init?.cache).toBe("no-store");
		expect(headers.get("accept")).toContain("text/html");
		expect(headers.get("cache-control")).toBe("no-cache");
		expect(headers.get("user-agent")).toBe("SmartDeploy-HealthProbe/1.0");
	});
});
