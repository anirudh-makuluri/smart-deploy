import { describe, expect, it } from "vitest";
import {
	msUntilNextTenMinuteMark,
	resolveReconciledStatus,
} from "@/lib/deploymentHealthReconciler";

describe("resolveReconciledStatus", () => {
	it("promotes failed to running when at least 2 of 3 probes succeed", () => {
		expect(resolveReconciledStatus("failed", [true, true, false])).toBe("running");
		expect(resolveReconciledStatus("failed", [true, true, true])).toBe("running");
	});

	it("does not promote failed when only one probe succeeds", () => {
		expect(resolveReconciledStatus("failed", [true, false, false])).toBeNull();
	});

	it("demotes running to failed when all probes fail", () => {
		expect(resolveReconciledStatus("running", [false, false, false])).toBe("failed");
	});

	it("keeps running when any probe succeeds", () => {
		expect(resolveReconciledStatus("running", [true, false, false])).toBeNull();
		expect(resolveReconciledStatus("running", [false, true, false])).toBeNull();
	});
});

describe("msUntilNextTenMinuteMark", () => {
	it("returns 0 on a ten-minute boundary", () => {
		expect(msUntilNextTenMinuteMark(new Date(2026, 5, 7, 14, 50, 0, 0))).toBe(0);
	});

	it("waits until the next ten-minute mark", () => {
		const delay = msUntilNextTenMinuteMark(new Date(2026, 5, 7, 14, 43, 30, 0));
		expect(delay).toBe(6 * 60_000 + 30_000);
	});
});
