import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { AppDocumentStore } from "@/lib/apps/documentStore";
import { AppDocumentTable } from "@/lib/apps/documentSchema";

const table = "arn:aws:dynamodb:us-west-2:111122223333:table/pilot-documents";
const address = {
	appId: "11111111-1111-4111-8111-111111111111",
	environment: "published" as const,
	collection: "notes",
	id: "shared",
};
const snapshot = {
	Responses: [
		{ Item: { state: "active", version: 0, deletedAt: null, purgeAfter: null } },
		{ Item: { maxBytes: 100000, maxDocuments: 10, usedBytes: 0, documentCount: 0 } },
		{},
	],
};

describe("document SDK cancellation and explicit resource identity", () => {
	it("accepts table names for local fixtures and full AWS table ARNs for the pilot", () => {
		expect(AppDocumentTable.parse("local-documents")).toBe("local-documents");
		expect(AppDocumentTable.parse(table)).toBe(table);
		for (const invalid of [
			"x",
			"arn:aws:s3:::bucket",
			table + "/index/arbitrary",
			"arn:aws:dynamodb:evil.example:111122223333:table/documents",
		]) {
			expect(AppDocumentTable.safeParse(invalid).success).toBe(false);
		}
	});
	it("makes no SDK call for an already-aborted operation", async () => {
		const send = vi.fn();
		const store = new AppDocumentStore(
			{ send } as unknown as DynamoDBDocumentClient,
			table,
			Date.now,
			AbortSignal.abort(),
		);
		await expect(store.get(address)).rejects.toMatchObject({ status: 503 });
		expect(send).not.toHaveBeenCalled();
	});
	it("propagates one signal to reads and writes and keeps the full table ARN", async () => {
		const send = vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValueOnce({});
		const signal = new AbortController().signal;
		const store = new AppDocumentStore(
			{ send } as unknown as DynamoDBDocumentClient,
			table,
			Date.now,
			signal,
		);
		await expect(store.put(address, "{}", null)).resolves.toMatchObject({
			collection: "notes",
			id: "shared",
			json: "{}",
		});
		expect(send).toHaveBeenCalledTimes(2);
		for (const [command, options] of send.mock.calls) {
			expect(options.abortSignal).toBe(signal);
			const entries = command.input.TransactItems;
			for (const entry of entries) {
				const item = entry.Get ?? entry.Put ?? entry.Update ?? entry.ConditionCheck;
				expect(item.TableName).toBe(table);
			}
		}
	});
	it("discards a late SDK read after its signal is aborted", async () => {
		let finish: () => void = () => {};
		const send = vi.fn(
			() =>
				new Promise((resolve) => {
					finish = () => resolve(snapshot);
				}),
		);
		const controller = new AbortController();
		const store = new AppDocumentStore(
			{ send } as unknown as DynamoDBDocumentClient,
			table,
			Date.now,
			controller.signal,
		);
		const result = store.get(address);
		controller.abort();
		finish();
		await expect(result).rejects.toMatchObject({ status: 503 });
		expect(send).toHaveBeenCalledTimes(1);
	});
});
