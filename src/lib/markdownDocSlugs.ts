/** Pure helpers for doc slugs — safe to import from client components. */

export function slugFromMarkdownFilename(filename: string): string {
	return filename.replace(/\.md$/i, "").replace(/_/g, "-").toLowerCase();
}

export function titleFromMarkdownFilename(filename: string): string {
	const base = filename.replace(/\.md$/i, "");
	return base
		.split("_")
		.map((word) => word.charAt(0) + word.slice(1).toLowerCase())
		.join(" ");
}
