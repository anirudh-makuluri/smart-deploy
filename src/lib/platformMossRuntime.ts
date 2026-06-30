import {
	IndexManager,
	ManageClient,
	type DocumentInfo,
	type MutationOptions,
	type SearchResult,
} from "@moss-dev/moss-core";

const DEFAULT_MODEL = "moss-minilm";
const JOB_POLL_INTERVAL_MS = 2000;
const JOB_POLL_MAX_ATTEMPTS = 90;

export type PlatformMossDoc = {
	id: string;
	text: string;
};

export function getMossIndexName(): string {
	return (
		process.env.MOSS_DOCS_INDEX_NAME?.trim() ||
		process.env.MOSS_HELP_AGENT_INDEX_NAME?.trim() ||
		"smart_deploy_help_docs"
	);
}

export function isMossConfigured(): boolean {
	return Boolean(process.env.MOSS_PROJECT_ID?.trim() && process.env.MOSS_PROJECT_KEY?.trim());
}

export class PlatformMossRuntime {
	private readonly manageClient: ManageClient;
	private readonly indexManager: IndexManager;

	constructor(projectId: string, projectKey: string) {
		this.manageClient = new ManageClient(projectId, projectKey);
		this.indexManager = new IndexManager(projectId, projectKey);
	}

	static createFromEnv(): PlatformMossRuntime | null {
		const projectId = process.env.MOSS_PROJECT_ID?.trim() || "";
		const projectKey = process.env.MOSS_PROJECT_KEY?.trim() || "";
		if (!projectId || !projectKey) {
			return null;
		}
		return new PlatformMossRuntime(projectId, projectKey);
	}

	private async waitForJob(jobId: string): Promise<void> {
		for (let attempt = 0; attempt < JOB_POLL_MAX_ATTEMPTS; attempt += 1) {
			const status = await this.manageClient.getJobStatus(jobId);
			if (status.status === "completed") {
				return;
			}
			if (status.status === "failed") {
				throw new Error(status.error || `Moss job ${jobId} failed`);
			}
			await new Promise((resolve) => {
				setTimeout(resolve, JOB_POLL_INTERVAL_MS);
			});
		}
		throw new Error(`Moss job ${jobId} timed out`);
	}

	private toDocumentInfos(docs: PlatformMossDoc[]): DocumentInfo[] {
		return docs.map((doc) => ({
			id: doc.id,
			text: doc.text,
		}));
	}

	async loadIndex(indexName: string): Promise<void> {
		await this.indexManager.loadIndex(indexName);
	}

	async hasLoadedIndex(indexName: string): Promise<boolean> {
		return this.indexManager.hasIndex(indexName);
	}

	async createIndex(indexName: string, docs: PlatformMossDoc[]): Promise<void> {
		const result = await this.manageClient.createIndex(indexName, this.toDocumentInfos(docs), DEFAULT_MODEL);
		await this.waitForJob(result.jobId);
	}

	async addDocs(indexName: string, docs: PlatformMossDoc[], options?: MutationOptions): Promise<void> {
		const result = await this.manageClient.addDocs(indexName, this.toDocumentInfos(docs), options);
		await this.waitForJob(result.jobId);
	}

	async query(indexName: string, question: string, topK: number): Promise<SearchResult> {
		const hasIndex = await this.indexManager.hasIndex(indexName);
		if (!hasIndex) {
			await this.loadIndex(indexName);
		}
		return this.indexManager.queryText(indexName, question, topK);
	}
}