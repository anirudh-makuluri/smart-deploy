export function buildVerificationCandidates(baseUrl: string): string[] {
	const trimmed = baseUrl.trim();
	if (!trimmed) return [];
	const urls = new Set<string>();
	const paths = ["/", "/health", "/healthz", "/api/health"];
	const baseCandidates = trimmed.startsWith("http")
		? [trimmed]
		: trimmed.includes(".elb.amazonaws.com")
			? [`http://${trimmed}`, `https://${trimmed}`]
			: [`https://${trimmed}`, `http://${trimmed}`];
	for (const candidateBase of baseCandidates) {
		for (const pathName of paths) {
			try {
				const url = new URL(candidateBase);
				url.pathname = pathName;
				url.search = "";
				url.hash = "";
				urls.add(url.toString());
			} catch {
				// Ignore malformed candidates and keep trying the next path.
			}
		}
	}
	return Array.from(urls);
}

export function isSuccessfulVerificationStatus(status: number): boolean {
	return status >= 200 && status < 400;
}

export async function fetchWithTimeout(url: string, timeoutMs: number, externalSignal?: AbortSignal) {
	const controller = new AbortController();
	const handleExternalAbort = () => controller.abort();
	if (externalSignal) {
		if (externalSignal.aborted) {
			controller.abort();
		} else {
			externalSignal.addEventListener("abort", handleExternalAbort, { once: true });
		}
	}
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, {
			method: "GET",
			redirect: "follow",
			cache: "no-store",
			headers: {
				Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
				"Cache-Control": "no-cache",
				"User-Agent": "SmartDeploy-HealthProbe/1.0",
			},
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
		externalSignal?.removeEventListener("abort", handleExternalAbort);
	}
}

export type DeploymentProbeResult = {
	reachable: boolean;
	checkedUrl: string | null;
	httpStatus: number | null;
	latencyMs: number | null;
};

export async function probeDeploymentHealth(
	baseUrl: string,
	requestTimeoutMs = 8_000
): Promise<DeploymentProbeResult> {
	const candidates = buildVerificationCandidates(baseUrl);
	if (candidates.length === 0) {
		return {
			reachable: false,
			checkedUrl: null,
			httpStatus: null,
			latencyMs: null,
		};
	}

	const roundController = new AbortController();
	const probes = candidates.map((candidate) => {
		const startedAt = Date.now();
		return fetchWithTimeout(candidate, requestTimeoutMs, roundController.signal).then((response) => {
			const latencyMs = Date.now() - startedAt;
			if (isSuccessfulVerificationStatus(response.status)) {
				return {
					reachable: true,
					checkedUrl: candidate,
					httpStatus: response.status,
					latencyMs,
				} satisfies DeploymentProbeResult;
			}

			throw {
				reachable: false,
				checkedUrl: candidate,
				httpStatus: response.status,
				latencyMs,
			} satisfies DeploymentProbeResult;
		});
	});

	try {
		const winner = await Promise.any(probes);
		roundController.abort();
		return winner;
	} catch (error) {
		roundController.abort();
		const aggregate = error as AggregateError & { errors?: unknown[] };
		const firstFailure = Array.isArray(aggregate.errors) ? aggregate.errors[0] : null;
		if (firstFailure && typeof firstFailure === "object") {
			const failure = firstFailure as Partial<DeploymentProbeResult>;
			return {
				reachable: false,
				checkedUrl: failure.checkedUrl ?? candidates[0] ?? null,
				httpStatus: failure.httpStatus ?? null,
				latencyMs: failure.latencyMs ?? null,
			};
		}
		return {
			reachable: false,
			checkedUrl: candidates[0] ?? null,
			httpStatus: null,
			latencyMs: null,
		};
	}
}

export async function probeDeploymentReachable(
	baseUrl: string,
	requestTimeoutMs = 8_000
): Promise<boolean> {
	const result = await probeDeploymentHealth(baseUrl, requestTimeoutMs);
	return result.reachable;
}
