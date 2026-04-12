import "server-only";
import fs from "fs/promises";
import path from "path";

const DOCS_DIR = path.join(process.cwd(), "docs");
const README_PATH = path.join(process.cwd(), "README.md");

export type DocGuideEntry = {
	slug: string;
	filename: string;
	title: string;
};

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

export async function listDocMarkdownFiles(): Promise<DocGuideEntry[]> {
	const names = await fs.readdir(DOCS_DIR);
	return names
		.filter((n) => n.endsWith(".md") && !n.startsWith("."))
		.sort((a, b) => a.localeCompare(b))
		.map((filename) => ({
			filename,
			slug: slugFromMarkdownFilename(filename),
			title: titleFromMarkdownFilename(filename),
		}));
}

export async function readProjectReadme(): Promise<string> {
	return fs.readFile(README_PATH, "utf-8");
}

export async function readDocsMarkdownBySlug(
	slug: string,
): Promise<{ content: string; title: string; filename: string } | null> {
	const files = await listDocMarkdownFiles();
	const hit = files.find((f) => f.slug === slug);
	if (!hit) return null;
	const content = await fs.readFile(path.join(DOCS_DIR, hit.filename), "utf-8");
	return { content, title: hit.title, filename: hit.filename };
}
