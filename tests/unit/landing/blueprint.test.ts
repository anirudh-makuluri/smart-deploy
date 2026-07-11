import { describe, expect, it } from "vitest";
import {
	BLUEPRINT_STAGE_COUNT,
	BLUEPRINT_STAGES,
	getBlueprintStageStatus,
	isBlueprintComplete,
} from "@/lib/landing/blueprint";

describe("blueprint", () => {
	it("exposes an ordered pipeline of stages", () => {
		expect(BLUEPRINT_STAGES.length).toBe(BLUEPRINT_STAGE_COUNT);
		expect(BLUEPRINT_STAGES[0].id).toBe("resolve");
	});

	it("resolves stages left to right", () => {
		expect(getBlueprintStageStatus(0, 0)).toBe("active");
		expect(getBlueprintStageStatus(1, 0)).toBe("pending");
		expect(getBlueprintStageStatus(0, 1)).toBe("ok");
		expect(getBlueprintStageStatus(1, 1)).toBe("active");
	});

	it("reports completion once all stages resolve", () => {
		expect(isBlueprintComplete(BLUEPRINT_STAGE_COUNT)).toBe(true);
		expect(isBlueprintComplete(BLUEPRINT_STAGE_COUNT - 1)).toBe(false);
		for (let i = 0; i < BLUEPRINT_STAGE_COUNT; i++) {
			expect(getBlueprintStageStatus(i, BLUEPRINT_STAGE_COUNT)).toBe("ok");
		}
	});
});
