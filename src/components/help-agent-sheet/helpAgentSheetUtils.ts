export function slugFromDocFilename(filename: string): string {
	return filename.replace(/\.md$/i, "").replace(/_/g, "-").toLowerCase();
}

export function sourceToHref(source: string): string {
	if (source === "README.md") return "/docs";
	const docMatch = /^docs\/(.+\.md)$/i.exec(source);
	if (!docMatch) return "/docs";
	return `/docs/${slugFromDocFilename(docMatch[1])}`;
}

export function sourceToLabel(source: string): string {
	if (source === "README.md") return "README";
	return source.replace(/^docs\//, "").replace(/\.md$/i, "");
}

export function docCitationsForDisplay(citations: string[]): string[] {
	return citations.flatMap((citation) => (citation !== "README.md" ? [citation] : []));
}

export const STARTER_PROMPTS = [
	"Why is my deploy failing?",
	"How do I set up Supabase correctly?",
	"Why is WebSocket not connecting?",
];
