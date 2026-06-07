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
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
		externalSignal?.removeEventListener("abort", handleExternalAbort);
	}
}

export async function probeDeploymentReachable(
	baseUrl: string,
	requestTimeoutMs = 8_000
): Promise<boolean> {
	const candidates = buildVerificationCandidates(baseUrl);
	if (candidates.length === 0) return false;

	const roundController = new AbortController();
	let roundResolved = false;
	const probes = candidates.map(async (candidate) => {
		const response = await fetchWithTimeout(candidate, requestTimeoutMs, roundController.signal);
		if (response.status < 500) {
			return true;
		}
		throw new Error(`HTTP ${response.status}`);
	});

	try {
		await Promise.any(probes);
		roundResolved = true;
		roundController.abort();
		return true;
	} catch {
		if (!roundResolved) {
			roundController.abort();
		}
		return false;
	}
}
