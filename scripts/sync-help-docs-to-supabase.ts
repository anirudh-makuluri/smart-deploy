import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: path.join(process.cwd(), ".env") });

type HelpDocRow = {
	source_path: string;
	title: string;
	content: string;
	checksum: string;
	tags: string[];
	updated_at: string;
};

function walkMarkdownFiles(dirPath: string): string[] {
	if (!fs.existsSync(dirPath)) return [];
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const nextPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkMarkdownFiles(nextPath));
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
			files.push(nextPath);
		}
	}

	return files;
}

function getTitle(content: string, fallback: string): string {
	const match = /^#\s+(.+)$/m.exec(content);
	return (match?.[1] || fallback).trim();
}

function toTag(sourcePath: string): string[] {
	const lower = sourcePath.toLowerCase();
	const tags = ["help-agent", "docs"];

	if (lower.includes("troubleshooting")) tags.push("troubleshooting");
	if (lower.includes("error")) tags.push("errors");
	if (lower.includes("aws")) tags.push("aws");
	if (lower.includes("gcp")) tags.push("gcp");
	if (lower.includes("supabase")) tags.push("supabase");
	if (lower.includes("self_hosting")) tags.push("self-hosting");

	return Array.from(new Set(tags));
}

function buildRows(rootDir: string): HelpDocRow[] {
	const readmePath = path.join(rootDir, "README.md");
	const docsDir = path.join(rootDir, "docs");

	const filePaths = [
		...(fs.existsSync(readmePath) ? [readmePath] : []),
		...walkMarkdownFiles(docsDir),
	];

	return filePaths.map((absolutePath) => {
		const content = fs.readFileSync(absolutePath, "utf8").trim();
		const sourcePath = path.relative(rootDir, absolutePath).replace(/\\/g, "/");
		const checksum = crypto.createHash("sha256").update(content).digest("hex");
		const titleFallback = path.basename(sourcePath, ".md").replace(/[_-]/g, " ");
		return {
			source_path: sourcePath,
			title: getTitle(content, titleFallback),
			content,
			checksum,
			tags: toTag(sourcePath),
			updated_at: new Date().toISOString(),
		};
	});
}

async function main() {
	const rootDir = process.cwd();
	const supabaseUrl = process.env.SUPABASE_URL?.trim() || "";
	const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
	const prune = process.argv.includes("--prune");

	if (!supabaseUrl || !supabaseServiceRoleKey) {
		throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env");
	}

	const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
		auth: { persistSession: false },
	});

	const rows = buildRows(rootDir);
	if (rows.length === 0) {
		console.log("No markdown docs found to sync.");
		return;
	}

	const batchSize = 50;
	for (let i = 0; i < rows.length; i += batchSize) {
		const batch = rows.slice(i, i + batchSize);
		const { error } = await supabase
			.from("help_docs")
			.upsert(batch, { onConflict: "source_path", ignoreDuplicates: false });
		if (error) throw error;
	}

	if (prune) {
		const sourcePaths = rows.map((row) => row.source_path);
		const { error } = await supabase
			.from("help_docs")
			.delete()
			.not("source_path", "in", `(${sourcePaths.map((v) => `\"${v}\"`).join(",")})`);
		if (error) throw error;
	}

	console.log(`Synced ${rows.length} markdown docs to public.help_docs.`);
	if (prune) console.log("Pruned stale rows from public.help_docs.");
}

main().catch((error) => {
	console.error("Failed to sync help docs to Supabase:", error);
	process.exit(1);
});
