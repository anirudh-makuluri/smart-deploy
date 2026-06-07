import type {
	SDAnalyzeBuildStatus,
	SDArtifactsResponse,
	SDBuildVerification,
	SDDeployShape,
	SDDeployUnit,
	SDRailpackPlan,
	SDRepairAttempt,
} from "@/app/types";

const ANALYZE_BUILD_STATUSES: SDAnalyzeBuildStatus[] = [
	"passed",
	"failed",
	"partial",
	"skipped",
	"error",
	"not_run",
];

const ANALYZE_DEPLOY_SHAPES: SDDeployShape[] = [
	"static",
	"static_build",
	"server",
	"multi",
	"existing_docker",
];

function parseBuildStatus(value: unknown): SDAnalyzeBuildStatus {
	if (typeof value === "string" && ANALYZE_BUILD_STATUSES.includes(value as SDAnalyzeBuildStatus)) {
		return value as SDAnalyzeBuildStatus;
	}
	return "not_run";
}

function parseDeployShape(value: unknown): SDDeployShape {
	if (typeof value === "string" && ANALYZE_DEPLOY_SHAPES.includes(value as SDDeployShape)) {
		return value as SDDeployShape;
	}
	return "server";
}

function parseRailpackPlan(value: unknown): SDRailpackPlan | null {
	if (value === null) return null;
	if (!value || typeof value !== "object") return null;
	return value as SDRailpackPlan;
}

function parseDeployUnit(raw: Record<string, unknown>): SDDeployUnit | null {
	const name = typeof raw.name === "string" ? raw.name.trim() : "";
	if (!name) return null;
	const root = typeof raw.root === "string" ? raw.root : ".";
	const type = typeof raw.type === "string" ? raw.type : "server";
	const provider = typeof raw.provider === "string" ? raw.provider : "unknown";
	const framework =
		raw.framework === null ? null : typeof raw.framework === "string" ? raw.framework : null;
	const port =
		typeof raw.port === "number" && Number.isFinite(raw.port) && raw.port > 0 ? Math.floor(raw.port) : 3000;

	const art =
		raw.artifacts && typeof raw.artifacts === "object"
			? (raw.artifacts as Record<string, unknown>)
			: {};
	const railpack_plan = parseRailpackPlan(art.railpack_plan);
	const railpack_json =
		art.railpack_json === null
			? null
			: art.railpack_json && typeof art.railpack_json === "object"
				? (art.railpack_json as Record<string, unknown>)
				: null;

	return {
		name,
		root,
		type,
		provider,
		framework,
		port,
		artifacts: { railpack_plan, railpack_json },
	};
}

function parseBuildVerification(value: unknown): SDBuildVerification {
	if (!value || typeof value !== "object") return {};
	const v = value as Record<string, unknown>;
	return {
		backend: typeof v.backend === "string" ? v.backend : undefined,
		status: typeof v.status === "string" ? v.status : undefined,
		message: typeof v.message === "string" ? v.message : undefined,
		attempts: typeof v.attempts === "number" ? v.attempts : undefined,
		duration_seconds: typeof v.duration_seconds === "number" ? v.duration_seconds : undefined,
		log_excerpt: typeof v.log_excerpt === "string" ? v.log_excerpt : undefined,
	};
}

function parseRepairHistory(value: unknown): SDRepairAttempt[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
		.map((r) => ({
			attempt: typeof r.attempt === "number" ? r.attempt : undefined,
			unit_name: typeof r.unit_name === "string" ? r.unit_name : undefined,
			diagnosis: typeof r.diagnosis === "string" ? r.diagnosis : undefined,
			patch: r.patch && typeof r.patch === "object" ? (r.patch as Record<string, unknown>) : undefined,
			railpack_json_after_merge:
				r.railpack_json_after_merge === null
					? null
					: r.railpack_json_after_merge && typeof r.railpack_json_after_merge === "object"
						? (r.railpack_json_after_merge as Record<string, unknown>)
						: undefined,
			build_log_excerpt: typeof r.build_log_excerpt === "string" ? r.build_log_excerpt : undefined,
			build_exit_code: typeof r.build_exit_code === "number" ? r.build_exit_code : null,
			duration_seconds: typeof r.duration_seconds === "number" ? r.duration_seconds : undefined,
			result: typeof r.result === "string" ? r.result : undefined,
		}));
}

function parseTokenUsage(value: unknown): SDArtifactsResponse["token_usage"] {
	const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return {
		input_tokens: typeof raw.input_tokens === "number" ? raw.input_tokens : 0,
		output_tokens: typeof raw.output_tokens === "number" ? raw.output_tokens : 0,
		total_tokens: typeof raw.total_tokens === "number" ? raw.total_tokens : 0,
	};
}

/** Map sd-artifacts `AnalyzeResponse` into `SDArtifactsResponse`. */
function normalizeSdAnalyzePayload(p: Record<string, unknown>): SDArtifactsResponse | null {
	if (!Array.isArray(p.deploy_units)) return null;

	const deploy_units = (p.deploy_units as unknown[])
		.filter((u): u is Record<string, unknown> => Boolean(u && typeof u === "object"))
		.map((u) => parseDeployUnit(u))
		.filter((u): u is SDDeployUnit => Boolean(u));

	const errorsRaw = Array.isArray(p.errors) ? p.errors : [];
	const errors = errorsRaw.filter((e): e is string => typeof e === "string");

	const pipeline_trace = Array.isArray(p.pipeline_trace)
		? p.pipeline_trace.filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
		: [];

	return {
		response_id: typeof p.response_id === "string" ? p.response_id : "",
		commit_sha: typeof p.commit_sha === "string" ? p.commit_sha : "",
		package_path: typeof p.package_path === "string" ? p.package_path : ".",
		deploy_shape: parseDeployShape(p.deploy_shape),
		build_status: parseBuildStatus(p.build_status),
		railpack_version: p.railpack_version === null || typeof p.railpack_version === "string" ? p.railpack_version : null,
		workflow_version:
			p.workflow_version === null || typeof p.workflow_version === "string" ? p.workflow_version : null,
		deploy_briefing: typeof p.deploy_briefing === "string" ? p.deploy_briefing : "",
		deploy_units,
		build_verification: parseBuildVerification(p.build_verification),
		repair_history: parseRepairHistory(p.repair_history),
		pipeline_trace,
		errors,
		llm_outputs:
			p.llm_outputs && typeof p.llm_outputs === "object"
				? (p.llm_outputs as Record<string, unknown>)
				: {},
		inputs_snapshot:
			p.inputs_snapshot && typeof p.inputs_snapshot === "object"
				? (p.inputs_snapshot as Record<string, unknown>)
				: {},
		token_usage: parseTokenUsage(p.token_usage),
	};
}

/** True when the payload is a normalized sd-artifacts analyze scan. */
export function isSdArtifactsAnalyzeScan(scan: unknown): scan is SDArtifactsResponse {
	return (
		typeof scan === "object" &&
		scan !== null &&
		!Array.isArray(scan) &&
		Array.isArray((scan as SDArtifactsResponse).deploy_units)
	);
}

function unwrapKnownContainers(value: unknown): unknown {
	let current = value;
	for (let i = 0; i < 4; i += 1) {
		if (!current || typeof current !== "object") break;
		const record = current as Record<string, unknown>;
		if (record.response !== undefined) {
			current = record.response;
			continue;
		}
		if (record.output !== undefined) {
			current = record.output;
			continue;
		}
		if (record.data !== undefined && typeof record.data !== "string") {
			current = record.data;
			continue;
		}
		if (record.result !== undefined) {
			current = record.result;
			continue;
		}
		if (record.payload !== undefined) {
			current = record.payload;
			continue;
		}
		break;
	}
	return current;
}

function parseLooseJson(raw: string): unknown {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const withoutDataPrefix = trimmed.startsWith("data:") ? trimmed.replace(/^data:\s*/, "") : trimmed;
	try {
		return JSON.parse(withoutDataPrefix);
	} catch {
		const firstBrace = withoutDataPrefix.indexOf("{");
		const lastBrace = withoutDataPrefix.lastIndexOf("}");
		if (firstBrace >= 0 && lastBrace > firstBrace) {
			const candidate = withoutDataPrefix.slice(firstBrace, lastBrace + 1);
			return JSON.parse(candidate);
		}
		throw new Error("Invalid JSON payload");
	}
}

/** Normalize an sd-artifacts analyze payload (HTTP or SSE complete event). */
export function normalizeScanResultPayload(value: unknown): SDArtifactsResponse | null {
	try {
		let payload: unknown = value;
		if (typeof payload === "string") {
			payload = parseLooseJson(payload);
		}

		payload = unwrapKnownContainers(payload);
		if (typeof payload === "string") {
			payload = parseLooseJson(payload);
			payload = unwrapKnownContainers(payload);
		}

		if (!payload || typeof payload !== "object") return null;
		const p = payload as Record<string, unknown>;

		if (!Array.isArray(p.deploy_units)) return null;
		return normalizeSdAnalyzePayload(p);
	} catch {
		return null;
	}
}
