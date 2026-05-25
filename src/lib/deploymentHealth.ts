import type { DeploymentHealthCheck, DeploymentHealthFailureType, DeploymentHealthStatus } from "@/app/types";
import dns from "dns/promises";
import net from "net";

type LookupResult = Awaited<ReturnType<typeof dns.lookup>>;

export type VerifyDeploymentUrlHealthOptions = {
	timeoutMs?: number;
	maxRedirects?: number;
	fetchImpl?: typeof fetch;
	dnsLookup?: (hostname: string) => Promise<LookupResult>;
	now?: () => Date;
};

export type VerifyDeploymentUrlHealthResult = {
	status: DeploymentHealthStatus;
	httpStatus: number | null;
	failureType: DeploymentHealthFailureType | null;
	latencyMs: number;
	errorMessage: string | null;
	checkedAt: string;
	finalUrl: string;
	redirectCount: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;

function isIpAddress(hostname: string): boolean {
	return net.isIP(hostname) !== 0;
}

function normalizeFailure(
	status: DeploymentHealthStatus,
	failureType: DeploymentHealthFailureType | null,
	latencyMs: number,
	errorMessage: string | null,
	checkedAt: string,
	finalUrl: string,
	redirectCount: number,
	httpStatus: number | null = null,
): VerifyDeploymentUrlHealthResult {
	return {
		status,
		httpStatus,
		failureType,
		latencyMs,
		errorMessage,
		checkedAt,
		finalUrl,
		redirectCount,
	};
}

function classifyNetworkError(
	error: unknown,
	latencyMs: number,
	checkedAt: string,
	finalUrl: string,
	redirectCount: number,
): VerifyDeploymentUrlHealthResult {
	const err = error instanceof Error ? error : new Error(String(error));
	const message = err.message || "Health check failed";
	const causeCode =
		typeof (err as Error & { cause?: { code?: string } }).cause?.code === "string"
			? ((err as Error & { cause?: { code?: string } }).cause?.code as string)
			: "";
	const combined = `${causeCode} ${message}`.toLowerCase();

	if (err.name === "AbortError" || /timed out|timeout|und_err_connect_timeout/.test(combined)) {
		return normalizeFailure("timeout", "timeout", latencyMs, message, checkedAt, finalUrl, redirectCount);
	}

	if (/enotfound|eai_again|dns/.test(combined)) {
		return normalizeFailure("unreachable", "dns_failure", latencyMs, message, checkedAt, finalUrl, redirectCount);
	}

	if (/econnrefused|connection refused/.test(combined)) {
		return normalizeFailure("unreachable", "connection_refused", latencyMs, message, checkedAt, finalUrl, redirectCount);
	}

	if (/tls|ssl|certificate|cert_altname|self_signed/.test(combined)) {
		return normalizeFailure("tls_error", "tls_error", latencyMs, message, checkedAt, finalUrl, redirectCount);
	}

	if (/redirect/.test(combined)) {
		return normalizeFailure("redirect_loop", "redirect_loop", latencyMs, message, checkedAt, finalUrl, redirectCount);
	}

	return normalizeFailure("degraded", "unknown", latencyMs, message, checkedAt, finalUrl, redirectCount);
}

export async function verifyDeploymentUrlHealth(
	inputUrl: string,
	options: VerifyDeploymentUrlHealthOptions = {},
): Promise<VerifyDeploymentUrlHealthResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	const fetchImpl = options.fetchImpl ?? fetch;
	const dnsLookup = options.dnsLookup ?? dns.lookup;
	const checkedAt = (options.now ?? (() => new Date()))().toISOString();
	const startedAt = Date.now();

	let parsed: URL;
	try {
		parsed = new URL(inputUrl);
	} catch {
		return normalizeFailure(
			"unreachable",
			"unknown",
			Date.now() - startedAt,
			"Invalid deployment URL",
			checkedAt,
			inputUrl,
			0,
		);
	}

	try {
		if (!isIpAddress(parsed.hostname)) {
			await dnsLookup(parsed.hostname);
		}
	} catch (error) {
		return classifyNetworkError(error, Date.now() - startedAt, checkedAt, inputUrl, 0);
	}

	let currentUrl = parsed.toString();
	let redirectCount = 0;

	while (true) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetchImpl(currentUrl, {
				method: "GET",
				redirect: "manual",
				cache: "no-store",
				signal: controller.signal,
			});
			clearTimeout(timeout);

			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get("location");
				if (!location) {
					return normalizeFailure(
						"redirect_loop",
						"redirect_loop",
						Date.now() - startedAt,
						"Redirect response missing Location header",
						checkedAt,
						currentUrl,
						redirectCount,
						response.status,
					);
				}
				if (redirectCount >= maxRedirects) {
					return normalizeFailure(
						"redirect_loop",
						"redirect_loop",
						Date.now() - startedAt,
						`Too many redirects while checking ${inputUrl}`,
						checkedAt,
						currentUrl,
						redirectCount,
						response.status,
					);
				}
				currentUrl = new URL(location, currentUrl).toString();
				redirectCount += 1;
				continue;
			}

			const latencyMs = Date.now() - startedAt;
			if (response.status >= 200 && response.status < 400) {
				return normalizeFailure("healthy", null, latencyMs, null, checkedAt, currentUrl, redirectCount, response.status);
			}

			return normalizeFailure(
				"http_error",
				"http_error",
				latencyMs,
				`Health check returned HTTP ${response.status}`,
				checkedAt,
				currentUrl,
				redirectCount,
				response.status,
			);
		} catch (error) {
			clearTimeout(timeout);
			return classifyNetworkError(error, Date.now() - startedAt, checkedAt, currentUrl, redirectCount);
		}
	}
}

export function toDeploymentHealthCheck(args: {
	repoName: string;
	serviceName: string;
	url: string;
	result: VerifyDeploymentUrlHealthResult;
	deploymentHistoryId?: string | null;
}): Omit<DeploymentHealthCheck, "id"> {
	return {
		repo_name: args.repoName,
		service_name: args.serviceName,
		deployment_history_id: args.deploymentHistoryId ?? null,
		url: args.url,
		status: args.result.status,
		http_status: args.result.httpStatus,
		failure_type: args.result.failureType,
		latency_ms: args.result.latencyMs,
		error_message: args.result.errorMessage,
		checked_at: args.result.checkedAt,
	};
}
