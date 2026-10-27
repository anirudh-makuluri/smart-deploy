import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRepo } from "../helpers/repoFixture";
import { useWorkerWebSocketSession } from "@/custom-hooks/useWorkerWebSocket";
import { useAppData } from "@/store/useAppData";
import { RUNTIME_APP, RUNTIME_REQUEST, runtimeView } from "../helpers/runtimeView";

const identity = vi.hoisted(() => ({ userId: "user-1" as string | null, sessionId: "session-1" }));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession: () => ({ data: identity.userId ? { user: { id: identity.userId }, session: { id: identity.sessionId } } : null }),
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
	volatileWrites = 0;
	ackTimeout = 0;
	get volatile() { this.volatileWrites++; return this; }
	timeout(milliseconds: number) { this.ackTimeout = milliseconds; return this; }
	async emitWithAck(event: string, payload: { requestId: string; appId: string }) {
		this.emittedEvents.push({ event, payload });
		return { ok: true, requestId: payload.requestId, appId: payload.appId, view: runtimeView() };
	}
	io = {
		on: (event: string, handler: (...args: unknown[]) => void) => {
			const set = this.managerHandlers.get(event) ?? new Set<(...args: unknown[]) => void>();
			set.add(handler);
			this.managerHandlers.set(event, set);
		},
		removeAllListeners: () => {
			this.managerHandlers.clear();
		},
		off: (event: string, handler: (...args: unknown[]) => void) => {
			this.managerHandlers.get(event)?.delete(handler);
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

	off(event: string, handler: (...args: unknown[]) => void) {
		this.handlers.get(event)?.delete(handler);
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

function HarnessWithPublishing({ actorId = "user-1" }: { actorId?: string }) {
	const { requestAppRuntime, socketStatus } = useWorkerWebSocketSession();
	const [outcome, setOutcome] = React.useState("");
	async function inspect() {
		try { await requestAppRuntime(actorId, { action: "inspect", appId: RUNTIME_APP, requestId: RUNTIME_REQUEST }, new AbortController().signal); setOutcome("confirmed"); }
		catch { setOutcome("unconfirmed"); }
	}
	return <><div data-testid="socket-status">{socketStatus}</div><div data-testid="publish-outcome">{outcome}</div><button onClick={() => void inspect()}>Inspect releases</button></>;
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
		identity.userId = "user-1";
		identity.sessionId = "session-1";
		vi.useFakeTimers();
		MockSocket.instances = [];
		useAppData.setState({
			activeRepo: makeRepo({
				id: "1",
				name: "smart-deploy",
				full_name: "acme/smart-deploy",
				html_url: "https://github.com/acme/smart-deploy",
				owner: { login: "acme" },
			}),
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

	it("removes its exact listeners and cancels pending reconnects on unmount", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true,
			json: async () => ({ token: createMockWsToken(Date.now() + 300000) }),
		} as Response);
		const view = render(<Harness />);
		await act(async () => { await Promise.resolve(); });
		const socket = MockSocket.instances[0]!;
		const external = vi.fn();
		socket.on("deploy:log", external);
		socket.io.on("reconnect_attempt", external);
		act(() => socket.close());
		expect(socket.reconnectTimer).not.toBeNull();
		view.unmount();
		expect(socket.manualDisconnect).toBe(true);
		expect(socket.reconnectTimer).toBeNull();
		expect([...socket.handlers.values()].flatMap((set) => [...set])).toEqual([external]);
		expect([...socket.managerHandlers.values()].flatMap((set) => [...set])).toEqual([external]);
		await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("replaces the connection and clears logs and cached credentials when the signed-in user changes", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true,
			json: async () => ({ token: createMockWsToken(Date.now() + 300000) }),
		} as Response);
		const view = render(<HarnessWithLogs />);
		await act(async () => { await Promise.resolve(); });
		const oldSocket = MockSocket.instances[0]!;
		act(() => oldSocket.emitServer("deploy:log", { msg: "First user's log" }));
		expect(screen.getByTestId("log-count").textContent).toBe("1");
		identity.userId = "user-2";
		view.rerender(<HarnessWithLogs />);
		await act(async () => { await Promise.resolve(); });
		expect(oldSocket.manualDisconnect).toBe(true);
		expect(MockSocket.instances).toHaveLength(2);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(screen.getByTestId("log-count").textContent).toBe("0");
		act(() => oldSocket.emitServer("deploy:log", { msg: "Stale user's log" }));
		expect(screen.getByTestId("log-count").textContent).toBe("0");
	});

	it("retires the socket and cached token when the same user receives a new login session", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ token: createMockWsToken(Date.now() + 300000) }) } as Response);
		const view = render(<Harness />); await act(async () => { await Promise.resolve(); });
		const previous = MockSocket.instances[0]!; identity.sessionId = "session-2"; view.rerender(<Harness />);
		await act(async () => { await Promise.resolve(); });
		expect(previous.manualDisconnect).toBe(true); expect(MockSocket.instances).toHaveLength(2); expect(fetchMock).toHaveBeenCalledTimes(2); expect(screen.getByTestId("socket-status")).toHaveTextContent("open");
	});
	it("uses a bounded volatile acknowledgement with only the runtime command", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ token: createMockWsToken(Date.now() + 300000) }) } as Response);
		render(<HarnessWithPublishing />); await act(async () => { await Promise.resolve(); });
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Inspect releases" })); });
		const socket = MockSocket.instances[0]!; expect(socket.volatileWrites).toBe(1); expect(socket.ackTimeout).toBe(22000);
		expect(socket.emittedEvents.filter(row => row.event === "apps:runtime")).toEqual([{ event: "apps:runtime", payload: { action: "inspect", appId: RUNTIME_APP, requestId: RUNTIME_REQUEST } }]);
		expect(screen.getByTestId("publish-outcome")).toHaveTextContent("confirmed");
	});
	it("does not send a runtime command for a different actor or an offline socket", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ token: createMockWsToken(Date.now() + 300000) }) } as Response);
		const view = render(<HarnessWithPublishing actorId="different-user" />); await act(async () => { await Promise.resolve(); });
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Inspect releases" })); });
		expect(screen.getByTestId("publish-outcome")).toHaveTextContent("unconfirmed");
		view.rerender(<HarnessWithPublishing />); act(() => MockSocket.instances[0]!.close());
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Inspect releases" })); });
		expect(MockSocket.instances[0]!.volatileWrites).toBe(0);
	});
	it("does not reconnect or retain displayed logs after sign-out", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true,
			json: async () => ({ token: createMockWsToken(Date.now() + 300000) }),
		} as Response);
		const view = render(<HarnessWithLogs />);
		await act(async () => { await Promise.resolve(); });
		const socket = MockSocket.instances[0]!;
		act(() => socket.emitServer("deploy:log", { msg: "Private log" }));
		identity.userId = null;
		view.rerender(<HarnessWithLogs />);
		await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
		expect(screen.getByTestId("socket-status").textContent).toBe("closed");
		expect(screen.getByTestId("log-count").textContent).toBe("0");
		expect(socket.manualDisconnect).toBe(true);
		expect(MockSocket.instances).toHaveLength(1);
	});

	it("does not open a disposed socket when an in-flight token request completes", async () => {
		let resolveResponse: (response: Response) => void = () => { throw new Error("Request not started"); };
		vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>((resolve) => { resolveResponse = resolve; }));
		const view = render(<Harness />);
		const socket = MockSocket.instances[0]!;
		view.unmount();
		await act(async () => {
			resolveResponse({ ok: true, json: async () => ({ token: createMockWsToken(Date.now() + 300000) }) } as Response);
			await Promise.resolve();
		});
		expect(socket.connected).toBe(false);
		expect([...socket.handlers.values()].every((set) => set.size === 0)).toBe(true);
	});

	it("keeps a late previous-user token isolated from the new connection's reconnect cache", async () => {
		let resolveOldToken: (response: Response) => void = () => { throw new Error("No old request"); };
		const fetchMock = vi.spyOn(globalThis, "fetch")
			.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveOldToken = resolve; }))
			.mockResolvedValue({ ok: true, json: async () => ({ token: createMockWsToken(Date.now() + 300000) }) } as Response);
		const view = render(<Harness />);
		identity.userId = "user-2";
		view.rerender(<Harness />);
		await act(async () => { await Promise.resolve(); });
		expect(screen.getByTestId("socket-status").textContent).toBe("open");
		await act(async () => {
			resolveOldToken({ ok: true, json: async () => ({ token: createMockWsToken(Date.now() + 600000) }) } as Response);
			await Promise.resolve();
		});
		act(() => MockSocket.instances[1]!.close());
		await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(MockSocket.instances[0]!.connected).toBe(false);
		expect(screen.getByTestId("socket-status").textContent).toBe("open");
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
				activeRepo: makeRepo({
					id: "2",
					name: "Pluto",
					full_name: "acme/Pluto",
					html_url: "https://github.com/acme/Pluto",
					owner: { login: "acme" },
				}),
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
