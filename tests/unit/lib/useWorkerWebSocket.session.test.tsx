import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkerWebSocketSession } from "@/custom-hooks/useWorkerWebSocket";
import { toast } from "sonner";

vi.mock("sonner", () => ({
	toast: {
		info: vi.fn(),
		error: vi.fn(),
		success: vi.fn(),
	},
}));

class MockWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	static instances: MockWebSocket[] = [];

	url: string;
	readyState = MockWebSocket.CONNECTING;
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;

	constructor(url: string) {
		this.url = url;
		MockWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = MockWebSocket.OPEN;
			this.onopen?.(new Event("open"));
		});
	}

	send(_data: string) {}

	emitMessage(data: unknown) {
		this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
	}

	close() {
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.(new CloseEvent("close"));
	}
}

function Harness() {
	const { socketStatus } = useWorkerWebSocketSession({
		connectionEnabled: true,
		repoName: "smart-deploy",
		serviceName: "web",
	});

	return <div data-testid="socket-status">{socketStatus}</div>;
}

function HarnessWithToasts() {
	const { socketStatus } = useWorkerWebSocketSession({
		connectionEnabled: true,
		repoName: "smart-deploy",
		serviceName: "web",
		announceActiveDeployments: true,
	});

	return <div data-testid="socket-status">{socketStatus}</div>;
}

function HarnessWithLogs() {
	const { deployLogEntries, socketStatus } = useWorkerWebSocketSession({
		connectionEnabled: true,
		repoName: "smart-deploy",
		serviceName: "web",
	});

	const lastMessage = deployLogEntries[deployLogEntries.length - 1]?.message ?? "";

	return (
		<>
			<div data-testid="socket-status">{socketStatus}</div>
			<div data-testid="log-count">{deployLogEntries.length}</div>
			<div data-testid="last-log">{lastMessage}</div>
		</>
	);
}

describe("useWorkerWebSocketSession", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		MockWebSocket.instances = [];
		vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("retries after a failed ws-token fetch and eventually opens the socket", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce({ ok: false, status: 500 } as Response)
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ token: "token-123" }),
			} as Response);

		render(<Harness />);

		await act(async () => {
			await Promise.resolve();
		});

		expect(screen.getByTestId("socket-status").textContent).toBe("error");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
			await vi.advanceTimersByTimeAsync(0);
			await Promise.resolve();
		});

		expect(screen.getByTestId("socket-status").textContent).toBe("open");

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(MockWebSocket.instances.length).toBe(1);
		expect(MockWebSocket.instances[0]?.url).toContain("auth=token-123");
	});

	it("shows active deployment toast when server reports running deployments", async () => {
		const infoSpy = vi.mocked(toast.info);
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ token: "token-abc" }),
		} as Response);

		render(<HarnessWithToasts />);

		await act(async () => {
			await Promise.resolve();
		});

		expect(screen.getByTestId("socket-status").textContent).toBe("open");

		const ws = MockWebSocket.instances[0];
		expect(ws).toBeDefined();

		await act(async () => {
			ws?.emitMessage({
				type: "active_deployments",
				payload: { deployments: [{ repoName: "smart-deploy", serviceName: "web" }] },
			});
		});

		expect(infoSpy).toHaveBeenCalledWith("Deployment in progress", {
			description: "web · smart-deploy",
		});
	});

	it("streams deploy logs in real time for the active workspace", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ token: "token-xyz" }),
		} as Response);

		render(<HarnessWithLogs />);

		await act(async () => {
			await Promise.resolve();
		});

		expect(screen.getByTestId("socket-status").textContent).toBe("open");

		const ws = MockWebSocket.instances[0];
		expect(ws).toBeDefined();

		await act(async () => {
			ws?.emitMessage({
				type: "deploy_logs",
				payload: { id: "deploy", msg: "Build started", time: "2026-04-14T00:00:00.000Z" },
			});
		});

		expect(screen.getByTestId("log-count").textContent).toBe("1");
		expect(screen.getByTestId("last-log").textContent).toBe("Build started");
	});
});
