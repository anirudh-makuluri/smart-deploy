export type ScanNodeId =
	| "scanner"
	| "clone_repo"
	| "classifier"
	| "railpack_prepare"
	| "deploy_briefing"
	| "railpack_build_repair"
	| "finalize";

export type ScanNodeStatus = "pending" | "running" | "done";

export type ScanNode = {
	id: ScanNodeId;
	label: string;
	desc: string;
};

export type ScanLogLine = {
	text: string;
	node: ScanNodeId;
	tone: "default" | "success";
};

export const SCAN_NODES: ReadonlyArray<ScanNode> = [
	{ id: "scanner", label: "Scanner", desc: "Resolve commit and repo scope" },
	{ id: "clone_repo", label: "Clone repo", desc: "Check out repository at commit" },
	{ id: "classifier", label: "Classifier", desc: "Detect deploy shape and units" },
	{ id: "railpack_prepare", label: "Railpack prepare", desc: "Generate Railpack build plan" },
	{ id: "deploy_briefing", label: "Deploy briefing", desc: "Operator summary (markdown)" },
	{ id: "railpack_build_repair", label: "Build & repair", desc: "Verify build; AI repair loop" },
	{ id: "finalize", label: "Finalize", desc: "Schema version and final status" },
];

export const SCAN_LOG_LINES: ReadonlyArray<ScanLogLine> = [
	{ text: "[scanner] resolving commit HEAD on main", node: "scanner", tone: "default" },
	{ text: "[clone] checking out repo at a3f82d1", node: "clone_repo", tone: "default" },
	{ text: "[classifier] detected: Next.js web app", node: "classifier", tone: "default" },
	{ text: "[classifier] deploy shape: multi-service container", node: "classifier", tone: "default" },
	{ text: "[railpack] generating build plan...", node: "railpack_prepare", tone: "default" },
	{ text: "[railpack] plan ready: 4 layers, node 20 base", node: "railpack_prepare", tone: "default" },
	{ text: "[briefing] operator summary generated", node: "deploy_briefing", tone: "default" },
	{ text: "[build] verifying build passes...", node: "railpack_build_repair", tone: "default" },
	{ text: "[build] build passed on first attempt", node: "railpack_build_repair", tone: "success" },
	{ text: "[finalize] schema v2 — analysis complete", node: "finalize", tone: "success" },
];

/** Total lines streamed during Smart Analysis. */
export const SCAN_LOG_COUNT = SCAN_LOG_LINES.length;

/** Per-line reveal cadence (ms) with jitter applied in the animation layer. */
export const SCAN_STREAM_TOTAL_MS = 2200;

function nodeLogBounds(node: ScanNodeId): { first: number; last: number } {
	let first = -1;
	let last = -1;
	for (let i = 0; i < SCAN_LOG_LINES.length; i++) {
		if (SCAN_LOG_LINES[i].node !== node) continue;
		if (first === -1) first = i;
		last = i;
	}
	return { first, last };
}

/**
 * Derives a node's visual status from how many log lines have streamed in.
 * `visibleLineCount` is the count of lines currently shown (0..SCAN_LOG_COUNT).
 */
export function getScanNodeStatus(node: ScanNodeId, visibleLineCount: number): ScanNodeStatus {
	const { first, last } = nodeLogBounds(node);
	if (first === -1) return "pending";
	if (visibleLineCount <= first) return "pending";
	if (visibleLineCount > last) return "done";
	return "running";
}

/** True once every node has reached the `done` state. */
export function isScanComplete(visibleLineCount: number): boolean {
	return visibleLineCount >= SCAN_LOG_COUNT;
}
