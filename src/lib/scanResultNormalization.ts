import type { SDArtifactsResponse } from "@/app/types";

function defaultArtifacts(): SDArtifactsResponse {
	return {
		response_id: null,
		commit_sha: "unknown",
		stack_tokens: [],
		files: [],
		risks: [],
		confidence: 0,
		token_usage: {
			input_tokens: 0,
			output_tokens: 0,
			total_tokens: 0,
		},
		// Legacy/derived shape for existing UI.
		stack_summary: "",
		services: [],
		dockerfiles: {},
		docker_compose: null,
		nginx_conf: null,
		has_existing_dockerfiles: false,
		has_existing_compose: false,
		hadolint_results: {},
		commands: {},
		build_verification: {},
		llm_outputs: {},
	};
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
		const base = defaultArtifacts();

		const tokenUsageRaw = (p.token_usage && typeof p.token_usage === "object") ? (p.token_usage as Record<string, unknown>) : {};
		const servicesRaw = Array.isArray(p.services) ? p.services : [];
		const filesRaw = Array.isArray(p.files) ? p.files : [];
		const files = filesRaw
			.filter((f): f is Record<string, unknown> => Boolean(f && typeof f === "object"))
			.map((f) => ({
				name: typeof f.name === "string" ? f.name : "",
				content: typeof f.content === "string" ? f.content : "",
				location: typeof f.location === "string" ? f.location : "",
			}))
			.filter((f) => f.name && f.location);

		// Derive legacy fields from files[] to keep current UI working.
		const dockerfilesFromFiles: Record<string, string> = {};
		let composeFromFiles: string | null = null;
		let nginxFromFiles: string | null = null;
		for (const f of files) {
			const loweredName = f.name.toLowerCase();
			const loweredLocation = f.location.toLowerCase();
			if (loweredName === "dockerfile" || loweredLocation.endsWith("/dockerfile") || loweredLocation === "dockerfile") {
				dockerfilesFromFiles[f.location] = f.content;
			} else if (loweredName === "docker-compose.yml" || loweredLocation.endsWith("/docker-compose.yml") || loweredLocation === "docker-compose.yml") {
				composeFromFiles = f.content;
			} else if (loweredName === "nginx.conf" || loweredLocation.endsWith("/nginx.conf") || loweredLocation === "/etc/nginx/conf.d/nginx.conf") {
				nginxFromFiles = f.content;
			}
		}

		return {
			...base,
			response_id: typeof p.response_id === "string" ? p.response_id : base.response_id,
			commit_sha: typeof p.commit_sha === "string" ? p.commit_sha : base.commit_sha,
			stack_tokens: Array.isArray(p.stack_tokens) ? p.stack_tokens.filter((v): v is string => typeof v === "string") : base.stack_tokens,
			files,
			risks: Array.isArray(p.risks) ? p.risks.filter((r): r is string => typeof r === "string") : base.risks,
			confidence: typeof p.confidence === "number" ? p.confidence : base.confidence,
			token_usage: {
				input_tokens: typeof tokenUsageRaw.input_tokens === "number" ? tokenUsageRaw.input_tokens : 0,
				output_tokens: typeof tokenUsageRaw.output_tokens === "number" ? tokenUsageRaw.output_tokens : 0,
				total_tokens: typeof tokenUsageRaw.total_tokens === "number" ? tokenUsageRaw.total_tokens : 0,
			},
			stack_summary: typeof p.stack_summary === "string"
				? p.stack_summary
				: (Array.isArray(p.stack_tokens) ? p.stack_tokens.filter((v): v is string => typeof v === "string").join(", ") : base.stack_summary),
			services: servicesRaw
				.filter((s): s is Record<string, unknown> => Boolean(s && typeof s === "object"))
				.map((svc) => ({
					name: typeof svc.name === "string" ? svc.name : "service",
					build_context: typeof svc.build_context === "string" ? svc.build_context : ".",
					port: typeof svc.port === "number" ? svc.port : 80,
					dockerfile_path: typeof svc.dockerfile_path === "string" ? svc.dockerfile_path : "Dockerfile",
					...(typeof svc.execution_root === "string" ? { execution_root: svc.execution_root } : {}),
					...(typeof svc.language === "string" ? { language: svc.language } : {}),
					...(typeof svc.framework === "string" ? { framework: svc.framework } : {}),
				})),
			dockerfiles: Object.keys(dockerfilesFromFiles).length > 0
				? dockerfilesFromFiles
				: (p.dockerfiles && typeof p.dockerfiles === "object")
				? Object.fromEntries(
					Object.entries(p.dockerfiles as Record<string, unknown>).filter(([, v]) => typeof v === "string") as Array<[string, string]>
				)
				: base.dockerfiles,
			docker_compose: composeFromFiles ?? (typeof p.docker_compose === "string" ? p.docker_compose : null),
			nginx_conf: nginxFromFiles ?? (typeof p.nginx_conf === "string" ? p.nginx_conf : null),
			has_existing_dockerfiles: typeof p.has_existing_dockerfiles === "boolean" ? p.has_existing_dockerfiles : base.has_existing_dockerfiles,
			has_existing_compose: typeof p.has_existing_compose === "boolean" ? p.has_existing_compose : base.has_existing_compose,
			hadolint_results: (p.hadolint_results && typeof p.hadolint_results === "object")
				? Object.fromEntries(
					Object.entries(p.hadolint_results as Record<string, unknown>).map(([k, v]) => {
						if (typeof v === "string") return [k, v];
						if (v && typeof v === "object") return [k, v as Record<string, unknown> | unknown[]];
						return [k, String(v ?? "")];
					})
				)
				: base.hadolint_results,
			commands: (p.commands && (Array.isArray(p.commands) || typeof p.commands === "object")) ? (p.commands as Record<string, unknown> | string[]) : base.commands,
			build_verification: (p.build_verification && typeof p.build_verification === "object") ? (p.build_verification as Record<string, unknown>) : base.build_verification,
			llm_outputs: (p.llm_outputs && typeof p.llm_outputs === "object") ? (p.llm_outputs as Record<string, unknown>) : base.llm_outputs,
		};
	} catch {
		return null;
	}
}
