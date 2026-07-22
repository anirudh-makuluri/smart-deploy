import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { repoType } from "@/app/types";
import { useWorkerWebSocketSession } from "@/custom-hooks/useWorkerWebSocket";
import { useAppData } from "@/store/useAppData";

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession: () => ({ data: { user: { id: "user-1" } } }),
	},
}));

vi.mock("sonner", () => ({
	toast: {
		info: vi.fn(),
		error: vi.fn(),
		success: vi.fn(),
	},
}));

class MockSocket {
	static instances: MockSocket[] = [];

	url: string;
	options: Record<string, unknown>;
	connected = false;
	active = false;
	reconnectAttempts = 0;
	emittedEvents: Array<{ event: string; payload: unknown }> = [];
	handlers = new Map<string, Set<(...args: unknown[]) => void>>();
	managerHandlers = new Map<string, Set<(...args: unknown[]) => void>>();
	reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	manualDisconnect = false;
	io = {
		on: (event: string, handler: (...args: unknown[]) => void) => {
			const set = this.managerHandlers.get(event) ?? new Set<(...args: unknown[]) => void>();
			set.add(handler);
			this.managerHandlers.set(event, set);
		},
		removeAllListeners: () => {
			this.managerHandlers.clear();
		},
	};

	constructor(url: string, options: Record<string, unknown>) {
		this.url = url;
		this.options = options;
		MockSocket.instances.push(this);
	}

	on(event: string, handler: (...args: unknown[]) => void) {
		const set = this.handlers.get(event) ?? new Set<(...args: unknown[]) => void>();
		set.add(handler);
		this.handlers.set(event, set);
		return this;
	}

	emit(event: string, payload: unknown) {
		this.emittedEvents.push({ event, payload });
		return true;
	}

	connect() {
		this.active = true;
		void this.authorizeAndConnect();
		return this;
	}

	disconnect() {
		this.manualDisconnect = true;
		this.active = false;
		this.connected = false;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.emitLocal("disconnect", "io client disconnect");
		return this;
	}

	close() {
		this.connected = false;
		this.active = true;
		this.emitLocal("disconnect", "transport close");
		this.scheduleReconnect();
	}

	removeAllListeners() {
		this.handlers.clear();
	}

	emitServer(event: string, payload?: unknown) {
		this.emitLocal(event, payload);
	}

	private emitLocal(event: string, payload?: unknown) {
		for (const handler of this.handlers.get(event) ?? []) {
			handler(payload);
		}
	}

	private emitManager(event: string, payload?: unknown) {
		for (const handler of this.managerHandlers.get(event) ?? []) {
			handler(payload);
		}
	}

	private scheduleReconnect() {
		if (!this.options.reconnection || this.manualDisconnect || this.reconnectTimer) {
			return;
		}

		const baseDelay = Number(this.options.reconnectionDelay ?? 1000);
		const maxDelay = Number(this.options.reconnectionDelayMax ?? 5000);
		const delay = Math.min(baseDelay * 2 ** this.reconnectAttempts, maxDelay);
		this.reconnectAttempts += 1;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			if (this.manualDisconnect) return;
			this.emitManager("reconnect_attempt", this.reconnectAttempts);
			void this.authorizeAndConnect();
		}, delay);
	}

	private async authorizeAndConnect() {
		const authPayload = await new Promise<{ token?: string }>((resolve) => {
			const auth = this.options.auth;
			if (typeof auth === "function") {
				auth((payload: { token?: string }) => resolve(payload));
				return;
			}
			resolve((auth as { token?: string } | undefined) ?? {});
		});

		if (this.manualDisconnect) return;

		if (authPayload.token) {
			this.connected = true;
			this.active = false;
			this.reconnectAttempts = 0;
			this.emitLocal("connect");
			return;
		}

		this.connected = false;
		this.active = true;
		this.emitLocal("connect_error", new Error("Unauthorized"));
		this.scheduleReconnect();
	}
}

vi.mock("socket.io-client", () => ({
	io: (url: string, options: Record<string, unknown>) => new MockSocket(url, options),
}));

function createMockWsToken(expiresAt: number) {
	const payload = Buffer.from(JSON.stringify({ userID: "user-1", exp: expiresAt })).toString("base64url");
	return `${payload}.signature`;
}

function Harness() {
	const { socketStatus } = useWorkerWebSocketSession();

	return <div data-testid="socket-status">{socketStatus}</div>;
}

function HarnessWithLogs() {
	const { clearDeploymentLogs, deployLogEntries, deployStatus, socketStatus } = useWorkerWebSocketSession();

	const lastMessage = deployLogEntries[deployLogEntries.length - 1]?.message ?? "";

	return (
		<>
			<div data-testid="socket-status">{socketStatus}</div>
			<div data-testid="deploy-status">{deployStatus}</div>
			<div data-testid="log-count">{deployLogEntries.length}</div>
			<div data-testid="last-log">{lastMessage}</div>
			<button type="button" onClick={clearDeploymentLogs}>
				Clear deployment logs
			</button>
		</>
	);
}

function HarnessWithAgent() {
	const { latestAgentEvent, runAgent, socketStatus } = useWorkerWebSocketSession();
	const latestMessage = latestAgentEvent?.payload.message ?? "";
	const latestKind = latestAgentEvent?.kind ?? "";

	return (
		<>
			<div data-testid="socket-status">{socketStatus}</div>
			<div data-testid="agent-kind">{latestKind}</div>
			<div data-testid="agent-message">{latestMessage}</div>
			<button type="button" onClick={() => runAgent("conversation-1", "Show me my deployments")}>
				Run agent
			</button>
		</>
	);
}

describe("useWorkerWebSocketSession", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		MockSocket.instances = [];
		useAppData.setState({
			activeRepo: {
				id: 1,
				name: "smart-deploy",
				full_name: "acme/smart-deploy",
				html_url: "https://github.com/acme/smart-deploy",
				owner: { login: "acme" },
			} as repoType,
			activeServiceName: "web",
		});
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
		useAppData.setState({
			activeRepo: null,
			activeServiceName: null,
		});
	});

	it("retries after a failed ws-token fetch and eventually opens the socket", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce({ ok: false, status: 500 } as Response)
			.mockResolvedValueOnce({ ok: false, status: 500 } as Response)
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ token: createMockWsToken(Date.now() + 5 * 60 * 1000) }),
			} as Response);

		render(<Harness />);

		await act(async () => {
			await Promise.resolve();
		});

		expect(screen.getByTestId("socket-status").textContent).toBe("error");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
			await Promise.resolve();
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1999);
			await Promise.resolve();
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
			await Promise.resolve();
		});

		expect(screen.getByTestId("socket-status").textContent).toBe("open");
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(MockSocket.instances.length).toBe(1);
	});

	it("streams deploy logs in real time for the active workspace", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ token: createMockWsToken(Date.now() + 5 * 60 * 1000) }),
		} as Response);

		render(<HarnessWithLogs />);

		await act(async () => {
			await Promise.resolve();
		});

		expect(screen.getByTestId("socket-status").textContent).toBe("open");

		const socket = MockSocket.instances[0];
		expect(socket).toBeDefined();

		await act(async () => {
			socket?.emitServer("deploy:log", {
				id: "deploy",
				msg: "Build started",
				time: "2026-04-14T00:00:00.000Z",
			});
		});

		expect(screen.getByTestId("log-count").textContent).toBe("1");
		expect(screen.getByTestId("last-log").textContent).toBe("Build started");
	});

	it("shows queued status until the deployment worker emits the first log", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ token: createMockWsToken(Date.now() + 5 * 60 * 1000) }),
		} as Response);

		render(<HarnessWithLogs />);

		await act(async () => {
			await Promise.resolve();
		});

		const socket = MockSocket.instances[0];
		expect(socket).toBeDefined();

		await act(async () => {
			socket?.emitServer("deploy:snapshot", {
				repoName: "smart-deploy",
				serviceName: "web",
				logEntries: [],
				status: "queued",
				error: null,
			});
		});

		expect(screen.getByTestId("deploy-status").textContent).toBe("queued");

		await act(async () => {
			socket?.emitServer("deploy:log", {
				id: "deploy",
				msg: "Deployment worker started",
				time: "2026-07-18T00:00:00.000Z",
			});
		});

		expect(screen.getByTestId("deploy-status").textContent).toBe("running");
	});

	it("clears live deployment logs when the active workspace changes", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ token: createMockWsToken(Date.now() + 5 * 60 * 1000) }),
		} as Response);

		render(<HarnessWithLogs />);

		await act(async () => {
			await Promise.resolve();
		});

		const socket = MockSocket.instances[0];
		expect(socket).toBeDefined();

		await act(async () => {
			socket?.emitServer("deploy:log", {
				id: "lexiguess-deploy",
				msg: "Lexiguess build started",
				time: "2026-04-14T00:00:00.000Z",
			});
		});

		expect(screen.getByTestId("log-count").textContent).toBe("1");

		await act(async () => {
			useAppData.setState({
				activeRepo: {
					id: 2,
					name: "Pluto",
					full_name: "acme/Pluto",
					html_url: "https://github.com/acme/Pluto",
					owner: { login: "acme" },
				} as repoType,
				activeServiceName: "server-node",
			});
		});

		expect(screen.getByTestId("log-count").textContent).toBe("0");
		expect(screen.getByTestId("last-log").textContent).toBe("");
	});

	it("clears the current deployment logs after a service is deleted", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ token: createMockWsToken(Date.now() + 5 * 60 * 1000) }),
		} as Response);

		render(<HarnessWithLogs />);

		await act(async () => {
			await Promise.resolve();
		});

		const socket = MockSocket.instances[0];
		expect(socket).toBeDefined();

		await act(async () => {
			socket?.emitServer("deploy:snapshot", {
				repoName: "smart-deploy",
				serviceName: "web",
				logEntries: [{ id: "build", message: "Build complete" }],
				status: "success",
				error: null,
			});
		});

		expect(screen.getByTestId("log-count").textContent).toBe("1");
		expect(screen.getByTestId("deploy-status").textContent).toBe("success");

		fireEvent.click(screen.getByRole("button", { name: "Clear deployment logs" }));

		expect(screen.getByTestId("log-count").textContent).toBe("0");
		expect(screen.getByTestId("deploy-status").textContent).toBe("not-started");
	});

	it("reuses a valid ws token for reconnects after the socket closes", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ token: createMockWsToken(Date.now() + 5 * 60 * 1000) }),
		} as Response);

		render(<Harness />);

		await act(async () => {
			await Promise.resolve();
		});

		expect(screen.getByTestId("socket-status").textContent).toBe("open");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(MockSocket.instances.length).toBe(1);

		await act(async () => {
			MockSocket.instances[0]?.close();
			await Promise.resolve();
		});

		expect(screen.getByTestId("socket-status").textContent).toBe("connecting");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
			await Promise.resolve();
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("socket-status").textContent).toBe("open");
	});

	it("emits agent runs and receives streamed agent events", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({
			ok: true,
			json: async () => ({ token: createMockWsToken(Date.now() + 5 * 60 * 1000) }),
		} as Response);

		render(<HarnessWithAgent />);

		await act(async () => {
			await Promise.resolve();
		});

		expect(screen.getByTestId("socket-status").textContent).toBe("open");

		const socket = MockSocket.instances[0];
		expect(socket).toBeDefined();

		await act(async () => {
			screen.getByRole("button", { name: "Run agent" }).click();
		});

		expect(socket?.emittedEvents).toContainEqual({
			event: "agent:run",
			payload: { conversationId: "conversation-1", message: "Show me my deployments" },
		});

		await act(async () => {
			socket?.emitServer("agent:accepted", {
				runId: "run-1",
				message: "I’m looking into that now.",
			});
			socket?.emitServer("agent:status", {
				runId: "run-1",
				message: "Checking your deployments.",
			});
			socket?.emitServer("agent:message", {
				runId: "run-1",
				message: "You have 1 deployment.",
			});
			socket?.emitServer("agent:complete", {
				runId: "run-1",
				message: "You have 1 deployment.",
			});
		});

		expect(screen.getByTestId("agent-kind").textContent).toBe("complete");
		expect(screen.getByTestId("agent-message").textContent).toBe("You have 1 deployment.");
	});
});
