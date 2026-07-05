const AWS_MISSING_RESOURCE_CODES = new Set([
	"ClusterNotFoundException",
	"InvalidInstanceID.NotFound",
	"ListenerNotFound",
	"LoadBalancerNotFound",
	"NotFound",
	"NotFoundException",
	"RuleNotFound",
	"ServiceNotFoundException",
	"TargetGroupNotFound",
]);

function collectErrorStrings(error: unknown): string[] {
	if (!error || typeof error !== "object") {
		return typeof error === "string" ? [error] : [];
	}

	const typed = error as {
		name?: unknown;
		code?: unknown;
		Code?: unknown;
		message?: unknown;
		Message?: unknown;
		Error?: {
			Code?: unknown;
			Message?: unknown;
		};
	};

	return [
		typed.name,
		typed.code,
		typed.Code,
		typed.message,
		typed.Message,
		typed.Error?.Code,
		typed.Error?.Message,
	]
		.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
		.map((value) => value.trim());
}

export function isAwsMissingResourceError(error: unknown): boolean {
	const values = collectErrorStrings(error);

	if (values.some((value) => AWS_MISSING_RESOURCE_CODES.has(value))) {
		return true;
	}

	return values.some((value) => {
		const normalized = value.toLowerCase();
		return (
			normalized.includes("could not be found") ||
			normalized.includes("does not exist") ||
			normalized.includes("not found") ||
			normalized.includes("no environment found") ||
			normalized.includes("no application found") ||
			normalized.includes("invalidparametervalue")
		);
	});
}
