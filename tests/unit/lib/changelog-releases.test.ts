import { describe, expect, it } from "vitest";
import { getChangelogReleases } from "@/lib/changelog-releasesCore";

describe("getChangelogReleases", () => {
	it("loads curated release notes and recent highlights", () => {
		const snapshot = getChangelogReleases();
		expect(snapshot.releases.length).toBeGreaterThan(0);
		expect(snapshot.recentHighlights.length).toBeGreaterThan(0);
		expect(snapshot.releases[0]?.highlights.length).toBeGreaterThan(0);
	});
});