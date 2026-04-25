import { getAllHelpDocChunks } from "@/lib/helpAgentDocsCore";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(process.cwd(), ".env") });
loadEnv({ path: path.join(process.cwd(), ".env.local"), override: true });

type MossClientLike = {
	createIndex: (name: string, docs: Array<{ id: string; text: string }>) => Promise<unknown>;
	loadIndex: (name: string) => Promise<unknown>;
	addDocs?: (name: string, docs: Array<{ id: string; text: string }>, options?: { upsert?: boolean }) => Promise<unknown>;
};

function toMossText(source: string, section: string, content: string): string {
	return [
		`SOURCE: ${source}`,
		`SECTION: ${section}`,
		"CONTENT:",
		content,
	].join("\n");
}

async function main() {
	const projectId = process.env.MOSS_PROJECT_ID?.trim() || "";
	const projectKey = process.env.MOSS_PROJECT_KEY?.trim() || "";
	const indexName = process.env.MOSS_HELP_AGENT_INDEX_NAME?.trim() || "smart_deploy_help_docs";
	const refresh = process.argv.includes("--refresh");

	if (!projectId || !projectKey) {
		throw new Error("Missing MOSS_PROJECT_ID or MOSS_PROJECT_KEY in environment");
	}

	const mossModule = await import("@moss-dev/moss");
	const MossClientCtor = (mossModule as { MossClient?: new (id: string, key: string) => MossClientLike }).MossClient;
	if (!MossClientCtor) {
		throw new Error("Failed to load MossClient from @moss-dev/moss");
	}

	const client = new MossClientCtor(projectId, projectKey);
	const chunks = await getAllHelpDocChunks();
	const docs = chunks.map((chunk, index) => ({
		id: `help-doc-${index}`,
		text: toMossText(chunk.source, chunk.section, chunk.content),
	}));

	if (docs.length === 0) {
		console.log("No help docs found to index.");
		return;
	}

	let loadedExisting = false;
	try {
		await client.loadIndex(indexName);
		loadedExisting = true;
		console.log(`Loaded existing Moss index: ${indexName}`);
	} catch {
		loadedExisting = false;
	}

	if (!loadedExisting) {
		const seedCount = Math.min(32, docs.length);
		await client.createIndex(indexName, docs.slice(0, seedCount));
		console.log(`Created Moss index ${indexName} with ${seedCount} seed docs.`);

		if (typeof client.addDocs === "function" && docs.length > seedCount) {
			for (let i = seedCount; i < docs.length; i += 40) {
				await client.addDocs(indexName, docs.slice(i, i + 40), { upsert: true });
			}
			console.log(`Added ${docs.length - seedCount} docs to index ${indexName}.`);
		}

		await client.loadIndex(indexName);
		console.log(`Index ready: ${indexName} (total docs: ${docs.length})`);
		return;
	}

	if (!refresh) {
		console.log("Index already exists. Use --refresh to upsert current docs.");
		return;
	}

	if (typeof client.addDocs !== "function") {
		console.log("This Moss client does not support addDocs refresh. Index left unchanged.");
		return;
	}

	for (let i = 0; i < docs.length; i += 40) {
		await client.addDocs(indexName, docs.slice(i, i + 40), { upsert: true });
	}

	console.log(`Refreshed index ${indexName} with ${docs.length} docs.`);
}

main().catch((error) => {
	console.error("Failed to create/refresh Moss index:", error);
	process.exit(1);
});
