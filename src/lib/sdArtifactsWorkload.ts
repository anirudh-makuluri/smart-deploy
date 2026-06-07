/**
 * Product-level workload classification for sd-artifacts analyze scans.
 * Same `/analyze` response forks by `deploy_shape`, unit `type` / `framework`, and Railpack `deploy.startCommand`.
 * @see sd-artifacts-integration.md §5–7 and SPA / static_build section.
 */

import type {
	SDAnalyzeBuildStatus,
	SDArtifactsResponse,
	SDDeployShape,
	SDDeployUnit,
	SDRailpackPlan,
} from "@/app/types";

/** What smart-deploy should optimize for after analyze (deploy path selection, UX). */
export type SmartDeployWorkloadProduct =
	| "existing_dockerfile"
	| "container_api"
	| "container_static_runtime"
	| "static_spa_no_runtime"
	| "multi_service";

export type UnitWorkloadInfo = {
	name: string;
	unitType: string;
	framework: string | null;
	provider: string;
	deployShape: SDDeployShape | undefined;
	hasStartCommand: boolean;
	startCommand?: string;
	product: SmartDeployWorkloadProduct;
	warnings: string[];
	/** Heuristic monorepo SPA build-arg: `RAILPACK_SPA_OUTPUT_DIR` (repo-relative). */
	suggestedRailpackSpaOutputDir?: string;
};

export type WorkloadClassification = {
	deployShape: SDDeployShape | undefined;
	buildStatus: SDAnalyzeBuildStatus | undefined;
	primaryProduct: SmartDeployWorkloadProduct;
	units: UnitWorkloadInfo[];
	globalWarnings: string[];
	/** One-line summary for overview UI */
	headline: string;
};

export function getRailpackStartCommand(plan: SDRailpackPlan | null | undefined): string | undefined {
	const s = plan?.deploy?.startCommand;
	if (typeof s !== "string") return undefined;
	const t = s.trim();
	return t || undefined;
}

function looksLikeVitePreview(cmd: string): boolean {
	return /\bvite\s+preview\b/i.test(cmd) || /\bpreview\s*--\s*host\b/i.test(cmd);
}

function looksLikeCaddyOrCommonStaticServer(cmd: string): boolean {
	const lower = cmd.toLowerCase();
	return (
		lower.includes("caddy") ||
		/\bnginx\b/.test(lower) ||
		/\bhttp-server\b/.test(lower) ||
		/\bnpx\s+serve\b/.test(lower) ||
		/\bserve\s+-s\b/.test(lower) ||
		/\bpython\s+-m\s+http\.server\b/.test(lower)
	);
}

function defaultSpaDistPath(unitRoot: string): string {
	const root = unitRoot.trim().replace(/\/+$/, "") || ".";
	return root === "." ? "dist" : `${root}/dist`;
}

function classifySingleUnit(
	unit: SDDeployUnit,
	deployShape: SDDeployShape | undefined
): UnitWorkloadInfo {
	const plan = unit.artifacts?.railpack_plan ?? null;
	const start = getRailpackStartCommand(plan);
	const hasStart = Boolean(start);
	const warnings: string[] = [];
	const fw = unit.framework?.toLowerCase() ?? null;
	const effectiveShape = deployShape;

	if (unit.type === "existing_docker" || effectiveShape === "existing_docker") {
		return {
			name: unit.name,
			unitType: unit.type,
			framework: unit.framework,
			provider: unit.provider,
			deployShape: effectiveShape,
			hasStartCommand: hasStart,
			startCommand: start,
			product: "existing_dockerfile",
			warnings,
		};
	}

	if (unit.type === "static" || effectiveShape === "static") {
		return {
			name: unit.name,
			unitType: unit.type,
			framework: unit.framework,
			provider: unit.provider,
			deployShape: effectiveShape,
			hasStartCommand: hasStart,
			startCommand: start,
			product: "static_spa_no_runtime",
			warnings: [
				...warnings,
				"Plain static deploy: expect minimal or no Railpack runtime — prefer object storage/CDN or a tiny static server.",
			],
			suggestedRailpackSpaOutputDir: defaultSpaDistPath(unit.root),
		};
	}

	if (unit.type === "static_build" || effectiveShape === "static_build") {
		const suggestedRailpackSpaOutputDir = defaultSpaDistPath(unit.root);

		if (!hasStart) {
			warnings.push(
				"No Railpack start command — common for monorepo build-only plans. Options: set RAILPACK_SPA_OUTPUT_DIR at build time for Caddy SPA image, extract dist to static hosting, or use POST /feedback."
			);
			return {
				name: unit.name,
				unitType: unit.type,
				framework: unit.framework,
				provider: unit.provider,
				deployShape: effectiveShape,
				hasStartCommand: false,
				product: "static_spa_no_runtime",
				warnings,
				suggestedRailpackSpaOutputDir,
			};
		}

		if (looksLikeVitePreview(start!)) {
			warnings.push(
				"Start command looks like Vite preview — discouraged for production. Prefer removing the start script for Railpack SPA/Caddy, or static artifact hosting."
			);
			return {
				name: unit.name,
				unitType: unit.type,
				framework: unit.framework,
				provider: unit.provider,
				deployShape: effectiveShape,
				hasStartCommand: true,
				startCommand: start,
				product: "container_static_runtime",
				warnings,
				suggestedRailpackSpaOutputDir,
			};
		}

		if (looksLikeCaddyOrCommonStaticServer(start!)) {
			return {
				name: unit.name,
				unitType: unit.type,
				framework: unit.framework,
				provider: unit.provider,
				deployShape: effectiveShape,
				hasStartCommand: true,
				startCommand: start,
				product: "container_static_runtime",
				warnings,
				suggestedRailpackSpaOutputDir,
			};
		}

		// static_build with some other start (e.g. custom node static server)
		return {
			name: unit.name,
			unitType: unit.type,
			framework: unit.framework,
			provider: unit.provider,
			deployShape: effectiveShape,
			hasStartCommand: true,
			startCommand: start,
			product: "container_static_runtime",
			warnings,
			suggestedRailpackSpaOutputDir,
		};
	}

	// server-shaped units (Go, Node, Python, Next SSR, etc.)
	if (fw === "next" && effectiveShape === "server") {
		warnings.push(
			"Next.js on server shape: treat as SSR/API unless you intentionally export static — confirm ports and runtime env."
		);
	}
	if ((fw === "vite" || fw === "astro" || fw === "svelte") && effectiveShape === "server") {
		warnings.push(
			`Framework "${fw}" with server deploy_shape is unusual — confirm sd-artifacts classification (SSR adapter vs mis-tagged static).`
		);
	}
	if (!hasStart && (unit.provider === "node" || unit.provider === "python" || unit.provider === "go")) {
		warnings.push(
			"No start command for an API-style unit — verify plan or use /feedback before production deploy."
		);
	}

	return {
		name: unit.name,
		unitType: unit.type,
		framework: unit.framework,
		provider: unit.provider,
		deployShape: effectiveShape,
		hasStartCommand: hasStart,
		startCommand: start,
		product: "container_api",
		warnings,
	};
}

function mergePrimaryProduct(units: UnitWorkloadInfo[], deployShape: SDDeployShape | undefined): SmartDeployWorkloadProduct {
	if (units.length > 1 || deployShape === "multi") {
		return "multi_service";
	}
	return units[0]?.product ?? "container_api";
}

function buildHeadline(primary: SmartDeployWorkloadProduct, deployShape: SDDeployShape | undefined): string {
	switch (primary) {
		case "existing_dockerfile":
			return "Workload: existing Dockerfile in repo (docker build, not Railpack).";
		case "container_static_runtime":
			return "Workload: frontend / static runtime in container (Caddy, preview, or custom static server).";
		case "static_spa_no_runtime":
			return "Workload: static frontend build — plan SPA image (RAILPACK_SPA_OUTPUT_DIR), or static artifact hosting.";
		case "multi_service":
			return "Workload: multiple deploy units — plan per-service images and routing.";
		case "container_api":
		default:
			if (deployShape === "static_build") {
				return "Workload: static build (Vite/Astro/etc.) — confirm container vs CDN strategy.";
			}
			return "Workload: API / long-running server (Node, Python, Go, Next SSR, …).";
	}
}

/**
 * Classify an sd-artifacts `SDArtifactsResponse` for smart-deploy UX and future deploy branching.
 * Returns `null` if there are no deploy units.
 */
export function classifyScanWorkload(scan: SDArtifactsResponse): WorkloadClassification | null {
	const units = scan.deploy_units ?? [];
	if (units.length === 0) return null;

	const deployShape = scan.deploy_shape;
	const buildStatus = scan.build_status;

	const unitInfos = units.map((u) => classifySingleUnit(u, deployShape));
	const primaryProduct = mergePrimaryProduct(unitInfos, deployShape);
	const globalWarnings: string[] = [];

	if (buildStatus === "skipped") {
		globalWarnings.push("Build was skipped on sd-artifacts — Railpack plan may be unverified; proceed carefully.");
	}
	if (buildStatus === "partial") {
		globalWarnings.push("Partial build: some units failed verification — deploy only passing units or re-run analyze/feedback.");
	}

	for (const u of unitInfos) {
		globalWarnings.push(...u.warnings);
	}

	return {
		deployShape,
		buildStatus,
		primaryProduct,
		units: unitInfos,
		globalWarnings: [...new Set(globalWarnings)],
		headline: buildHeadline(primaryProduct, deployShape),
	};
}

/** Human label for badges */
export function workloadProductLabel(product: SmartDeployWorkloadProduct): string {
	switch (product) {
		case "existing_dockerfile":
			return "Dockerfile";
		case "container_api":
			return "API / server";
		case "container_static_runtime":
			return "Static runtime (container)";
		case "static_spa_no_runtime":
			return "Static SPA (no start)";
		case "multi_service":
			return "Multi-service";
		default:
			return product;
	}
}
