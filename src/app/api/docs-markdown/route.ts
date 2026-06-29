import { NextResponse } from "next/server";
import { getChangelogCommits, getGithubRepoSlug, type GitChangelogCommit } from "@/lib/changelog-from-git";
import { getChangelogReleases } from "@/lib/changelog-releases";
import { readDocsMarkdownBySlug, readProjectReadme } from "@/lib/public-docs";

const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

function normalizeDocSlug(input: string): string {
	return input.trim().toLowerCase();
}

function renderChangelogMarkdown(commits: GitChangelogCommit[]): string {
	const repo = getGithubRepoSlug();
	const releases = getChangelogReleases();
	const lines: string[] = [
		"# Smart Deploy Changelog",
		"",
		"> Release notes from `src/data/changelog-releases.json` and commit log from `src/data/changelog-commits.json`.",
		"",
		`Repository: https://github.com/${repo}`,
		"",
	];

	if (releases.recentHighlights.length > 0) {
		lines.push("## Recent highlights", "");
		for (const item of releases.recentHighlights) {
			lines.push(`- **${item.title}** — ${item.description}${item.docHref ? ` (${item.docHref})` : ""}`);
		}
		lines.push("");
	}

	if (releases.releases.length > 0) {
		lines.push("## Release notes", "");
		for (const release of releases.releases) {
			lines.push(`### ${release.label} — ${release.title} (${release.date})`, "");
			lines.push(release.summary, "");
			for (const highlight of release.highlights) {
				lines.push(`- **${highlight.title}** — ${highlight.description}`);
			}
			lines.push("");
		}
	}

	lines.push("## Commit history", "");
	for (const commit of commits) {
		lines.push(
			`- ${commit.date} | \`${commit.shortHash}\` | ${commit.subject} (${`https://github.com/${repo}/commit/${commit.hash}`})`,
		);
	}

	return lines.join("\n");
}

async function resolveMarkdownBySlug(slug: string): Promise<string | null> {
	if (slug === "__readme__") {
		return readProjectReadme();
	}

	if (slug === "__changelog__") {
		return renderChangelogMarkdown(getChangelogCommits());
	}

	const doc = await readDocsMarkdownBySlug(slug);
	return doc?.content ?? null;
}

export async function GET(req: Request) {
	const { searchParams, pathname } = new URL(req.url);
	const fromSlug = searchParams.get("slug");
	const path = searchParams.get("path");

	let slug = fromSlug ? normalizeDocSlug(fromSlug) : "";

	if (!slug && path) {
		if (path === "/docs") slug = "__readme__";
		else if (path === "/changelog") slug = "__changelog__";
		else if (path.startsWith("/docs/")) slug = normalizeDocSlug(path.replace(/^\/docs\//, ""));
	}

	if (!slug) {
		if (pathname === "/docs.md") slug = "__readme__";
		else if (pathname === "/changelog.md") slug = "__changelog__";
		else {
			const mdDocPath = /^\/docs\/([^/]+)\.md$/i.exec(pathname);
			if (mdDocPath?.[1]) slug = normalizeDocSlug(mdDocPath[1]);
			else if (pathname === "/docs") slug = "__readme__";
			else if (pathname.startsWith("/docs/")) slug = normalizeDocSlug(pathname.replace(/^\/docs\//, ""));
			else if (pathname === "/changelog") slug = "__changelog__";
		}
	}

	if (!slug) {
		return new NextResponse("Missing slug", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
	}

	const markdown = await resolveMarkdownBySlug(slug);
	if (!markdown) {
		return new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
	}

	return new NextResponse(markdown, {
		status: 200,
		headers: {
			"Content-Type": MARKDOWN_CONTENT_TYPE,
			"Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
		},
	});
}
