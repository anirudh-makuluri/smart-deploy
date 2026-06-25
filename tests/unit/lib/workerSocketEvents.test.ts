import { describe, expect, it } from "vitest";
import { resolveWorkerSocketIoPath, resolveWorkerSocketIoServerUrl } from "@/lib/workerSocketEvents";

describe("workerSocketEvents", () => {
	it("defaults the Socket.IO path to /ws when the public url has no path", () => {
		expect(resolveWorkerSocketIoPath("wss://ws.example.com")).toBe("/ws");
		expect(resolveWorkerSocketIoPath("ws://localhost:4001")).toBe("/ws");
	});

	it("reuses an explicit websocket path when provided", () => {
		expect(resolveWorkerSocketIoPath("wss://ws.example.com/ws")).toBe("/ws");
		expect(resolveWorkerSocketIoPath("wss://ws.example.com/realtime")).toBe("/realtime");
	});

	it("derives the Socket.IO server origin without the path", () => {
		expect(resolveWorkerSocketIoServerUrl("wss://ws.example.com/ws")).toBe("https://ws.example.com");
		expect(resolveWorkerSocketIoServerUrl("ws://localhost:4001")).toBe("http://localhost:4001");
	});
});
