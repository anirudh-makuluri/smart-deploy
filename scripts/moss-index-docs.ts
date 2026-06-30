import { getAllPlatformDocChunks } from "@/lib/platformDocsCore";
import { getMossIndexName, PlatformMossRuntime } from "@/lib/platformMossRuntime";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(process.cwd(), ".env") });
loadEnv({ path: path.join(process.cwd(), ".env.local"), override: true });

function toMossText(source: string, section: string, content: string): string {
	return [
		`SOURCE: ${source}`,
		`SECTION: ${section}`,
		"CONTENT:",
		content,
	].join("\n");
}

async function main() {
	const runtime = PlatformMossRuntime.createFromEnv();
	const indexName = getMossIndexName();
	const refresh = process.argv.includes("--refresh");

	if (!runtime) {
		throw new Error("Missing MOSS_PROJECT_ID or MOSS_PROJECT_KEY in environment");
	}

	const chunks = await getAllPlatformDocChunks();
	const docs = chunks.map((chunk, index) => ({
		id: `platform-doc-${index}`,
		text: toMossText(chunk.source, chunk.section, chunk.content),
	}));

	if (docs.length === 0) {
		console.log("No platform docs found to index.");
		return;
	}

	let loadedExisting = false;
	try {
		await runtime.loadIndex(indexName);
		loadedExisting = true;
		console.log(`Loaded existing Moss index: ${indexName}`);
	} catch {
		loadedExisting = false;
	}

	if (!loadedExisting) {
		const seedCount = Math.min(32, docs.length);
		await runtime.createIndex(indexName, docs.slice(0, seedCount));
		console.log(`Created Moss index ${indexName} with ${seedCount} seed docs.`);

		if (docs.length > seedCount) {
			for (let i = seedCount; i < docs.length; i += 40) {
				await runtime.addDocs(indexName, docs.slice(i, i + 40), { upsert: true });
			}
			console.log(`Added ${docs.length - seedCount} docs to index ${indexName}.`);
		}

		await runtime.loadIndex(indexName);
		console.log(`Index ready: ${indexName} (total docs: ${docs.length})`);
		return;
	}

	if (!refresh) {
		console.log("Index already exists. Use --refresh to upsert current docs.");
		return;
	}

	for (let i = 0; i < docs.length; i += 40) {
		await runtime.addDocs(indexName, docs.slice(i, i + 40), { upsert: true });
	}

	console.log(`Refreshed index ${indexName} with ${docs.length} docs.`);
}

main().catch((error) => {
	console.error("Failed to create/refresh Moss index:", error);
	process.exit(1);
});