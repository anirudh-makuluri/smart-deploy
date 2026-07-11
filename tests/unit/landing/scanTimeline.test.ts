import { describe, expect, it } from "vitest";
import {
	SCAN_LOG_COUNT,
	SCAN_LOG_LINES,
	SCAN_NODES,
	getScanNodeStatus,
	isScanComplete,
} from "@/lib/landing/scanTimeline";

describe("scanTimeline", () => {
	it("maps every log line to a known node", () => {
		const nodeIds = new Set(SCAN_NODES.map((node) => node.id));
		for (const line of SCAN_LOG_LINES) {
			expect(nodeIds.has(line.node)).toBe(true);
		}
	});

	it("keeps every node pending before any line streams in", () => {
		for (const node of SCAN_NODES) {
			expect(getScanNodeStatus(node.id, 0)).toBe("pending");
		}
	});

	it("marks a node running while its lines stream and done once they land", () => {
		// classifier owns log indices 2 and 3.
		expect(getScanNodeStatus("classifier", 2)).toBe("pending");
		expect(getScanNodeStatus("classifier", 3)).toBe("running");
		expect(getScanNodeStatus("classifier", 4)).toBe("done");
	});

	it("marks all nodes done once streaming completes", () => {
		for (const node of SCAN_NODES) {
			expect(getScanNodeStatus(node.id, SCAN_LOG_COUNT)).toBe("done");
		}
		expect(isScanComplete(SCAN_LOG_COUNT)).toBe(true);
		expect(isScanComplete(SCAN_LOG_COUNT - 1)).toBe(false);
	});
});
