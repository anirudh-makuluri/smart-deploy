import type {
	DocumentInfo,
	IndexManager as MossIndexManager,
	ManageClient as MossManageClient,
	MutationOptions,
	SearchResult,
} from "@moss-dev/moss-core";

const DEFAULT_MODEL = "moss-minilm";
const JOB_POLL_INTERVAL_MS = 2000;
const JOB_POLL_MAX_ATTEMPTS = 90;

let mossCoreModulePromise: Promise<typeof import("@moss-dev/moss-core")> | null = null;

async function loadMossCoreModule(): Promise<typeof import("@moss-dev/moss-core")> {
	if (!mossCoreModulePromise) {
		mossCoreModulePromise = import("@moss-dev/moss-core");
	}
	return mossCoreModulePromise;
}

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

export async function runSequentialTasks<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
	await items.reduce(
		(promise, item) => promise.then(() => run(item)),
		Promise.resolve()
	);
}

export class PlatformMossRuntime {
	private readonly projectId: string;
	private readonly projectKey: string;
	private manageClient: MossManageClient | null;
	private indexManager: MossIndexManager | null;

	constructor(projectId: string, projectKey: string) {
		this.projectId = projectId;
		this.projectKey = projectKey;
		this.manageClient = null;
		this.indexManager = null;
	}

	static createFromEnv(): PlatformMossRuntime | null {
		const projectId = process.env.MOSS_PROJECT_ID?.trim() || "";
		const projectKey = process.env.MOSS_PROJECT_KEY?.trim() || "";
		if (!projectId || !projectKey) {
			return null;
		}
		return new PlatformMossRuntime(projectId, projectKey);
	}

	private async ensureClients(): Promise<void> {
		if (this.manageClient && this.indexManager) {
			return;
		}

		const { ManageClient, IndexManager } = await loadMossCoreModule();
		this.manageClient = new ManageClient(this.projectId, this.projectKey);
		this.indexManager = new IndexManager(this.projectId, this.projectKey);
	}

	private async getManageClient(): Promise<MossManageClient> {
		await this.ensureClients();
		if (!this.manageClient) {
			throw new Error("Moss manage client is unavailable");
		}
		return this.manageClient;
	}

	private async getIndexManager(): Promise<MossIndexManager> {
		await this.ensureClients();
		if (!this.indexManager) {
			throw new Error("Moss index manager is unavailable");
		}
		return this.indexManager;
	}

	private async waitForJob(jobId: string, attempt = 0): Promise<void> {
		if (attempt >= JOB_POLL_MAX_ATTEMPTS) {
			throw new Error(`Moss job ${jobId} timed out`);
		}

		const manageClient = await this.getManageClient();
		const status = await manageClient.getJobStatus(jobId);
		if (status.status === "completed") {
			return;
		}
		if (status.status === "failed") {
			throw new Error(status.error || `Moss job ${jobId} failed`);
		}

		await new Promise((resolve) => {
			setTimeout(resolve, JOB_POLL_INTERVAL_MS);
		});
		return this.waitForJob(jobId, attempt + 1);
	}

	private toDocumentInfos(docs: PlatformMossDoc[]): DocumentInfo[] {
		return docs.map((doc) => ({
			id: doc.id,
			text: doc.text,
		}));
	}

	async loadIndex(indexName: string): Promise<void> {
		const indexManager = await this.getIndexManager();
		await indexManager.loadIndex(indexName);
	}

	async hasLoadedIndex(indexName: string): Promise<boolean> {
		const indexManager = await this.getIndexManager();
		return indexManager.hasIndex(indexName);
	}

	async createIndex(indexName: string, docs: PlatformMossDoc[]): Promise<void> {
		const manageClient = await this.getManageClient();
		const result = await manageClient.createIndex(indexName, this.toDocumentInfos(docs), DEFAULT_MODEL);
		await this.waitForJob(result.jobId);
	}

	async addDocs(indexName: string, docs: PlatformMossDoc[], options?: MutationOptions): Promise<void> {
		const manageClient = await this.getManageClient();
		const result = await manageClient.addDocs(indexName, this.toDocumentInfos(docs), options);
		await this.waitForJob(result.jobId);
	}

	async query(indexName: string, question: string, topK: number): Promise<SearchResult> {
		const indexManager = await this.getIndexManager();
		const hasIndex = await indexManager.hasIndex(indexName);
		if (!hasIndex) {
			await this.loadIndex(indexName);
		}
		return indexManager.queryText(indexName, question, topK);
	}
}
