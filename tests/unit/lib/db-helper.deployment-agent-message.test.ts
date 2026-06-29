import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/dbPool", () => ({
	getDbPool: () => ({
		query: queryMock,
	}),
}));

describe("dbHelper.recordDeploymentAgentMessage", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		queryMock.mockResolvedValue({ rows: [{ id: "msg-1" }] });
	});

	it("inserts deployment agent messages with metadata", async () => {
		const { dbHelper } = await import("@/db-helper");

		const result = await dbHelper.recordDeploymentAgentMessage({
			userID: "user-1",
			conversationId: "conversation-1",
			runId: "550e8400-e29b-41d4-a716-446655440000",
			role: "assistant",
			content: "You have 1 deployment.",
			metadata: {
				kind: "assistant",
				outcome: "complete",
				llmTurns: [],
			},
		});

		expect(result).toEqual({ success: true, id: "msg-1" });
		expect(queryMock).toHaveBeenCalledTimes(1);
		const [sql, values] = queryMock.mock.calls[0] as [string, unknown[]];
		expect(sql).toContain("deployment_agent_messages");
		expect(values).toEqual(
			expect.arrayContaining([
				"user-1",
				"conversation-1",
				"550e8400-e29b-41d4-a716-446655440000",
				"assistant",
				"You have 1 deployment.",
				JSON.stringify({
					kind: "assistant",
					outcome: "complete",
					llmTurns: [],
				}),
			])
		);
	});

	it("rejects invalid run ids", async () => {
		const { dbHelper } = await import("@/db-helper");

		const result = await dbHelper.recordDeploymentAgentMessage({
			userID: "user-1",
			conversationId: "conversation-1",
			runId: "not-a-uuid",
			role: "user",
			content: "Hello",
			metadata: { kind: "user", promptTurnCount: 0 },
		});

		expect(result).toEqual({ error: "runId must be a valid uuid" });
		expect(queryMock).not.toHaveBeenCalled();
	});
});