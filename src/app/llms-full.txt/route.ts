import { NextResponse } from "next/server";
import { listDocMarkdownFiles, readDocsMarkdownBySlug, readProjectReadme } from "@/lib/public-docs";

function sectionHeader(title: string): string {
	return `\n\n---\n\n# ${title}\n\n`;
}

export async function GET() {
	const [readme, docs] = await Promise.all([readProjectReadme(), listDocMarkdownFiles()]);

	const chunks: string[] = [
		"# Smart Deploy Full Documentation",
		"",
		"> Canonical full-text snapshot for long-context agents.",
		"",
		"Source index: /llms.txt",
		"",
		sectionHeader("README"),
		readme.trim(),
	];

	const docContents = await Promise.all(
		docs.map(async (docMeta) => {
			const doc = await readDocsMarkdownBySlug(docMeta.slug);
			if (!doc) return null;
			return { filename: doc.filename, content: doc.content.trim() };
		})
	);
	for (const doc of docContents) {
		if (!doc) continue;
		chunks.push(sectionHeader(`docs/${doc.filename}`));
		chunks.push(doc.content);
	}

	return new NextResponse(chunks.join("\n"), {
		status: 200,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
		},
	});
}
