import fs from "fs";
import path from "path";

export type ChangelogRecentHighlight = {
	title: string;
	description: string;
	docHref: string | null;
};

export type ChangelogReleaseHighlight = {
	title: string;
	description: string;
	docHref: string | null;
};

export type ChangelogRelease = {
	date: string;
	label: string;
	title: string;
	summary: string;
	highlights: ChangelogReleaseHighlight[];
};

export type ChangelogReleasesSnapshot = {
	updatedAt: string;
	recentHighlights: ChangelogRecentHighlight[];
	releases: ChangelogRelease[];
};

const RELEASES_PATH = path.join(process.cwd(), "src", "data", "changelog-releases.json");

function normalizeDocHref(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function getChangelogReleases(): ChangelogReleasesSnapshot {
	try {
		const raw = fs.readFileSync(RELEASES_PATH, "utf-8");
		const data = JSON.parse(raw) as ChangelogReleasesSnapshot;
		if (!Array.isArray(data.releases)) {
			return { updatedAt: "", recentHighlights: [], releases: [] };
		}

		const recentHighlights = Array.isArray(data.recentHighlights)
			? data.recentHighlights.map((item) => ({
					title: String(item.title ?? ""),
					description: String(item.description ?? ""),
					docHref: normalizeDocHref(item.docHref),
				}))
			: [];

		const releases = data.releases.map((release) => ({
			date: String(release.date ?? ""),
			label: String(release.label ?? ""),
			title: String(release.title ?? ""),
			summary: String(release.summary ?? ""),
			highlights: Array.isArray(release.highlights)
				? release.highlights.map((highlight) => ({
						title: String(highlight.title ?? ""),
						description: String(highlight.description ?? ""),
						docHref: normalizeDocHref(highlight.docHref),
					}))
				: [],
		}));

		return {
			updatedAt: String(data.updatedAt ?? ""),
			recentHighlights,
			releases,
		};
	} catch {
		return { updatedAt: "", recentHighlights: [], releases: [] };
	}
}