import { createServer } from "node:http";
import { Client, Pool } from "pg";
import { io as connectSocket, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseTestConnectionString, prepareDatabaseTestRoles, resetFoundationDatabase } from "./helpers.mjs";

const mocks = vi.hoisted(() => ({ config: { WAITING_LIST_ENABLED: true }, approved: vi.fn() }));
vi.mock("@/config", () => ({ default: mocks.config }));
vi.mock("@/db-helper", () => ({ dbHelper: { isApprovedUser: mocks.approved } }));
vi.mock("@/lib/dbPool", () => ({ getDbPool: () => pool }));
import { requirePlatformSession, requirePlatformUser } from "../../src/lib/platformAccess";
import { authenticateCliAccessToken, approveDeviceAuthorization, consumeDeviceAuthorization, createCliAccessToken, startDeviceAuthorization } from "../../src/lib/cliAuth";
import { createWebSocketAuthToken } from "../../src/lib/wsAuth";
import { createWorkerSocketServer } from "../../src/lib/workerSocketServer";

const connectionString = databaseTestConnectionString();
const client = new Client({ connectionString });
const pool = new Pool({ connectionString, max: 3 });
const server = createServer();
const sockets = new Set<Socket>();
let worker: ReturnType<typeof createWorkerSocketServer>;
let address: string;
let executed = 0;

beforeAll(async () => {
	vi.stubEnv("BETTER_AUTH_SECRET", "local-worker-session-integration-secret-only");
	vi.stubEnv("NEXT_PUBLIC_WS_URL", "");
	await client.connect();
	await prepareDatabaseTestRoles(client);
	worker = createWorkerSocketServer(server, ["https://control.test"]);
	worker.on("connection", (socket) => {
		socket.on("error", () => {});
		socket.on("probe", (acknowledge: (value: string) => void) => { executed += 1; acknowledge("allowed"); });
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const bound = server.address();
	if (!bound || typeof bound === "string") throw new Error("Local socket fixture unavailable");
	address = `http://127.0.0.1:${bound.port}`;
});
afterEach(() => {
	for (const socket of sockets) socket.disconnect();
	sockets.clear();
	for (const socket of worker.sockets.sockets.values()) socket.disconnect(true);
});
afterAll(async () => {
	await new Promise<void>((resolve) => worker.close(() => resolve()));
	await pool.end();
	await client.end();
	vi.unstubAllEnvs();
});
beforeEach(async () => {
	await resetFoundationDatabase(client);
	mocks.config.WAITING_LIST_ENABLED = true;
	mocks.approved.mockReset().mockResolvedValue({ approved: true });
	executed = 0;
});

function connect(origin = "https://control.test", userId = "alice", sessionId = "alice-session"): Promise<Socket> {
	const socket = connectSocket(address, { path: "/ws", autoConnect: false, forceNew: true, transports: ["websocket"], reconnection: false,
		timeout: 2000, extraHeaders: { Origin: origin }, auth: { token: createWebSocketAuthToken(userId, sessionId) } });
	sockets.add(socket);
	return new Promise((resolve, reject) => { socket.once("connect", () => resolve(socket)); socket.once("connect_error", reject); socket.connect(); });
}

describe("verified management authority with PostgreSQL and actual worker transport", () => {
	it("does not mint a CLI credential when verification is lost between approval and redemption", async () => {
		const authorization = await startDeviceAuthorization();
		await expect(approveDeviceAuthorization(authorization.approvalCode, "alice")).resolves.toBe("approved");
		await client.query('update public."user" set "emailVerified" = false where id = \'alice\'');
		await expect(consumeDeviceAuthorization(authorization.deviceCode)).rejects.toMatchObject({ status: 403 });
		expect((await client.query("select status from public.cli_device_authorizations")).rows[0].status).toBe("approved");
		expect((await client.query("select token_hash from public.cli_access_tokens")).rowCount).toBe(0);
		await client.query('update public."user" set "emailVerified" = true where id = \'alice\'');
		await expect(consumeDeviceAuthorization(authorization.deviceCode)).resolves.toMatchObject({ userId: "alice" });
	});
	it("requires current verification independently of waiting-list approval", async () => {
		await expect(requirePlatformUser("alice")).resolves.toMatchObject({ id: "alice", emailVerified: true });
		await expect(requirePlatformUser("dave")).rejects.toMatchObject({ status: 403 });
		mocks.config.WAITING_LIST_ENABLED = false;
		await expect(requirePlatformUser("dave")).rejects.toMatchObject({ status: 403 });
	});
	it("rejects deleted, expired and mismatched platform sessions", async () => {
		await expect(requirePlatformSession("alice", "bob-session")).rejects.toMatchObject({ status: 401 });
		await client.query('update public.session set "expiresAt" = clock_timestamp() - interval \'1 second\' where id = \'alice-session\'');
		await expect(requirePlatformSession("alice", "alice-session")).rejects.toMatchObject({ status: 401 });
		await client.query("delete from public.session where id = 'bob-session'");
		await expect(requirePlatformSession("bob", "bob-session")).rejects.toMatchObject({ status: 401 });
	});
	it("denies an existing CLI credential after verification or approval is removed", async () => {
		const credential = createCliAccessToken();
		await client.query("insert into public.cli_access_tokens (user_id, token_hash) values ('alice', $1)", [credential.tokenHash]);
		await expect(authenticateCliAccessToken(credential.token)).resolves.toBe("alice");
		await client.query('update public."user" set "emailVerified" = false where id = \'alice\'');
		await expect(authenticateCliAccessToken(credential.token)).resolves.toBeNull();
		await client.query('update public."user" set "emailVerified" = true where id = \'alice\'');
		mocks.approved.mockResolvedValue({ approved: false });
		await expect(authenticateCliAccessToken(credential.token)).resolves.toBeNull();
	});
	it("closes an authorized connection before executing a packet after verification loss", async () => {
		const socket = await connect();
		await expect(new Promise<string>((resolve) => socket.emit("probe", resolve))).resolves.toBe("allowed");
		expect(executed).toBe(1);
		await client.query('update public."user" set "emailVerified" = false where id = \'alice\'');
		const disconnected = new Promise<void>((resolve) => socket.once("disconnect", () => resolve()));
		socket.emit("probe", () => { throw new Error("Denied packet executed"); });
		await disconnected;
		expect(executed).toBe(1);
	});
	it("rejects a signed credential for a revoked session and an unverified account", async () => {
		await client.query("delete from public.session where id = 'alice-session'");
		await expect(connect()).rejects.toThrow("Unauthorized");
		await expect(connect("https://control.test", "dave", "dave-session")).rejects.toThrow("Unauthorized");
	});
	it("rejects a sibling Origin for direct WebSocket transport while preserving the allowed Origin", async () => {
		await expect(connect("https://app.control.test")).rejects.toThrow();
		const socket = await connect();
		expect(socket.connected).toBe(true);
	});
});
