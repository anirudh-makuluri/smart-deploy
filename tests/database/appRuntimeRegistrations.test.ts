import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createTlsServer, connect as tlsConnect } from "node:tls";
import type { Duplex } from "node:stream";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../src/lib/apps/appStore";
import { AppRuntimeStore } from "../../src/lib/apps/runtimeStore";
import type { RuntimeBinding, RuntimeRegistrationInput } from "../../src/lib/apps/runtimeMetadata";
import { authenticateGateway, createGatewayServiceCredential } from "../../src/lib/apps/gatewayServiceAuth";
import { GatewayAuthStore } from "../../src/lib/apps/gatewayAuthStore";
import { WorkspaceStore } from "../../src/lib/apps/workspaceStore";
import { gatewayCertificate } from "../helpers/gatewayCertificate";
import { ManagedGatewayLoader } from "../../src/lib/gateway/managedRoute";
import { AppRuntimeController } from "../../src/lib/apps/runtimeController";
import type { RuntimeControlSettings } from "../../src/lib/apps/runtimeControlSettings";
import { PilotRuntimeVerifier } from "../../src/lib/aws/pilotRuntimeVerifier";
import { runtimeCredentialParameter } from "../../src/lib/apps/runtimeMetadata";
import { GATEWAY_SESSION_COOKIE } from "../../src/lib/gateway/cookies";
import { databaseTestConnectionString, prepareDatabaseTestRoles, resetFoundationDatabase } from "./helpers.mjs";

const ssm = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn() }));
vi.mock("@aws-sdk/client-ssm", async importOriginal => {
	const original = await importOriginal<typeof import("@aws-sdk/client-ssm")>();
	return { ...original, SSMClient: class { send = ssm.send; destroy = ssm.destroy; } };
});
const tlsServers = new Set<ReturnType<typeof createTlsServer>>(); const tlsSockets = new Set<Duplex>();
afterEach(async () => { for (const socket of tlsSockets) socket.destroy(); for (const server of tlsServers) await new Promise<void>(resolve => server.close(() => resolve())); tlsServers.clear(); ssm.send.mockReset(); });

const client = new Client({ connectionString: databaseTestConnectionString() });
const pool = new Pool({ connectionString: databaseTestConnectionString(), max: 4, application_name: "runtime-registration-tests" });
const scope = { accountId: "111122223333", region: "us-west-2", clusterName: "pilot", privateDomain: "apps.example.test" };
const store = new AppRuntimeStore(pool, scope); const workspaces = new WorkspaceStore(pool); const apps = new AppStore(pool);
const auth = new GatewayAuthStore(pool, { codeSeconds: 60, sessionSeconds: 900 });
const certificates: Awaited<ReturnType<typeof gatewayCertificate>>[] = [];
const migration = readFileSync(new URL("../../supabase/migrations/20261025_app_runtime_registrations.sql", import.meta.url), "utf8");
let workspaceId: string; let appId: string; let binding: RuntimeBinding;
const digest = "sha256:" + "a".repeat(64); const commit = "a".repeat(40);
beforeAll(async () => { await client.connect(); await prepareDatabaseTestRoles(client); });
afterAll(async () => { for (const material of certificates) await material.dispose(); await pool.end(); await client.end(); });
beforeEach(async () => {
	await resetFoundationDatabase(client);
	for (const name of ["20261023_workspace_invitations", "20261023_app_use_grants", "20261023_app_gateway_auth", "20261023_gateway_platform_sessions", "20261023_gateway_service_credentials", "20261024_gateway_environments"]) await client.query(readFileSync(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8"));
	await client.query(migration); workspaceId = (await workspaces.createWorkspace("alice", "Operations")).id;
	for (const [id, role] of [["bob", "admin"], ["carol", "member"]] as const) { const invitation = await workspaces.createInvitation(workspaceId, "alice", id + "@example.test", role); await workspaces.acceptInvitation(id, invitation.token); }
	appId = (await apps.createApp(workspaceId, "alice", "Inventory")).id;
	binding = await store.createBinding(appId, "preview", "alice");
});
async function registration(target = binding) {
	const deploymentId = "private-" + randomUUID(); const releaseId = randomUUID();
	await client.query("insert into public.deployments(id, repo_name, service_name, owner_id) values ($1, 'acme/tracker', 'web', 'alice')", [deploymentId]);
	await store.associateDraft(deploymentId, target.appId, target.environment, "alice");
	const registry = `${scope.accountId}.dkr.ecr.${scope.region}.amazonaws.com`;
	const artifact = { kind: "ecr_image", cloudProvider: "aws", deploymentTarget: "ecs", region: scope.region, ecrRegistry: registry, ecrRepoName: "pilot/tracker", imageUri: registry + "/pilot/tracker:build", imageDigest: digest,
		deployConfig: { id: deploymentId, repoName: "acme/tracker", serviceName: "web", commitSha: commit, cloudProvider: "aws", deploymentTarget: "ecs", region: scope.region, secretsArn: "preview-secret-must-not-be-copied" } };
	await client.query(`insert into public.deployment_runs(id, user_id, app_id, workspace_id, repo_name, service_name, commit_sha, success, finished_at, release_artifact)
    values ($1,'alice',$2,$3,'acme/tracker','web',$4,true,clock_timestamp(),$5)`, [releaseId, target.appId, target.workspaceId, commit, JSON.stringify(artifact)]);
	const key = createGatewayServiceCredential();
	await client.query("insert into public.app_gateway_service_credentials(id, binding_id, secret_hash, expires_at) values ($1,$2,$3,clock_timestamp()+interval '1 hour')", [key.id, target.id, key.secretHash]);
	const material = await gatewayCertificate({ bindingId: target.id, environment: target.environment, releaseId }); certificates.push(material);
	const preflight = await store.prepare(target.id, releaseId, "alice");
	const input: RuntimeRegistrationInput = { id: randomUUID(), bindingId: target.id, releaseId, credentialId: key.id, taskArn: `arn:aws:ecs:${scope.region}:${scope.accountId}:task/pilot/${randomUUID().replaceAll("-", "")}`, privateIp: "10.0.1.23", port: 443, certificatePem: material.cert, observedImageDigest: digest, expectedSourceFingerprint: preflight.sourceFingerprint };
	return { input, key, deploymentId, artifact, material };
}

async function liveRegisteredRuntime(target: RuntimeBinding) {
	const value = await registration(target);
	const server = createTlsServer({ key: value.material.key, cert: value.material.cert, minVersion: "TLSv1.3", maxVersion: "TLSv1.3", ALPNProtocols: ["http/1.1"] });
	tlsServers.add(server); server.on("connection", socket => { tlsSockets.add(socket); socket.on("error", () => {}); socket.once("close", () => tlsSockets.delete(socket)); });
	server.on("tlsClientError", () => {});
	await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
	const address = server.address(); if (!address || typeof address === "string") throw new Error("Loopback fixture unavailable.");
	value.input.port = address.port; await store.register(value.input); await store.activate(value.input.id, "alice", null);
	const parameter = runtimeCredentialParameter(target.id, value.input.id);
	const response = { Parameter: { Name: parameter, ARN: `arn:aws:ssm:${scope.region}:${scope.accountId}:parameter${parameter}`, Type: "SecureString", Version: 1, Value: value.key.token } };
	ssm.send.mockResolvedValue(response);
	const loader = new ManagedGatewayLoader(pool, { scope, appId: target.appId, environment: target.environment, platformOrigin: "https://control.test", documentsEnabled: true,
		timeoutMs: 3000, controlTimeoutMs: 1000, limits: { maxConnections: 2, maxRequestBytes: 32768, maxResponseBytes: 32768, timeoutMs: 5000, idleMs: 1000 } });
	return { ...value, loader, response };
}
describe("authoritative runtime registration metadata", () => {
	it("publishes two verified prepared releases while preserving the app session and retaining revocation", async () => {
		const published = await store.createBinding(appId, "published", "alice");
		const values = [await registration(published), await registration(published), await registration(binding)];
		const expiresAt = Math.floor(Date.now() / 1000) * 1000 + 600000;
		await client.query("update public.app_gateway_service_credentials set expires_at=to_timestamp($2::double precision/1000) where id=any($1::uuid[])", [values.map(value => value.key.id), expiresAt]);
		const targets: RuntimeControlSettings["targets"] = [];
		for (const [index, value] of values.entries()) {
			const server = createTlsServer({ key: value.material.key, cert: value.material.cert, minVersion: "TLSv1.3", maxVersion: "TLSv1.3", ALPNProtocols: ["http/1.1"] }); tlsServers.add(server);
			server.on("connection", socket => { tlsSockets.add(socket); socket.on("error", () => {}); socket.once("close", () => tlsSockets.delete(socket)); }); server.on("tlsClientError", () => {});
			await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }); const address = server.address(); if (!address || typeof address === "string") throw Error("TLS fixture unavailable.");
			targets.push({ credentialId: value.key.id, certificatePem: value.material.cert, label: "Test notes " + index,
				expected: { appId, bindingId: index === 2 ? binding.id : published.id, environment: index === 2 ? "preview" : "published", releaseId: value.input.releaseId, runtimeId: value.input.id,
					taskArn: value.input.taskArn, taskDefinitionArn: `arn:aws:ecs:${scope.region}:${scope.accountId}:task-definition/pilot-notes-${index}:1`, executionRoleArn: `arn:aws:iam::${scope.accountId}:role/pilot-execution`,
					appGroupId: index === 2 ? "sg-33333333" : "sg-22222222", appImage: `${value.artifact.ecrRegistry}/${value.artifact.ecrRepoName}@${digest}`, appPort: 3000, originPort: address.port } });
		}
		const settings: RuntimeControlSettings = { appId, expiresAt, targets, scope: { ...scope, vpcId: "vpc-11111111", subnetIds: ["subnet-11111111"], gatewayGroupId: "sg-11111111", gatewayEniId: "eni-11111111", gatewayInstanceId: "i-11111111",
			tlsImage: `${values[0].artifact.ecrRegistry}/pilot/tls@${digest}`, timeoutMs: 2000, maxPending: 1 } };
		const observed = vi.spyOn(PilotRuntimeVerifier.prototype, "inspect").mockImplementation(async expected => ({ taskArn: expected.taskArn, taskDefinitionArn: expected.taskDefinitionArn, networkInterfaceId: "eni-22222222", privateIp: "10.0.1.23", subnetId: "subnet-11111111", port: expected.originPort, appImageDigest: digest, tlsImageDigest: digest, observedAt: new Date() }));
		ssm.send.mockImplementation(async command => { const index = targets.findIndex(target => runtimeCredentialParameter(target.expected.bindingId, target.expected.runtimeId) === command.input.Name); return { Parameter: { Name: command.input.Name, ARN: `arn:aws:ssm:${scope.region}:${scope.accountId}:parameter${command.input.Name}`, Type: "SecureString", Version: 1, Value: values[index].key.token } }; });
		const controller = new AppRuntimeController(pool, settings, async principal => {
			const valid = await pool.query('select s.id from public.session s join public."user" u on u.id=s."userId" where s.id=$1 and u.id=$2 and u."emailVerified"=true and s."expiresAt">clock_timestamp()', [principal.sessionId, principal.userId]); if (valid.rowCount !== 1) throw Error("Local fixture session unavailable.");
		}, options => tlsConnect({ ...options, host: "127.0.0.1" }));
		try {
			await expect(authenticateGateway(pool, "Bearer " + values[0].key.token)).rejects.toMatchObject({ status: 401 });
			const command = { action: "activate", requestId: randomUUID(), appId, environment: "published", releaseId: values[0].input.releaseId, expectedCurrentId: null };
			expect(await controller.request({ userId: "alice", sessionId: "alice-session" }, command, new AbortController().signal)).toMatchObject({ ok: true });
			expect((await store.current(appId, "published"))?.id).toBe(values[0].input.id); await apps.grantUse(appId, "alice", "carol"); const session = await sessionFor(published, "carol");
			expect(await controller.request({ userId: "alice", sessionId: "alice-session" }, { ...command, requestId: randomUUID(), releaseId: values[1].input.releaseId, expectedCurrentId: values[0].input.id }, new AbortController().signal)).toMatchObject({ ok: true });
			expect((await store.current(appId, "published"))?.id).toBe(values[1].input.id); await expect(authenticateGateway(pool, "Bearer " + values[0].key.token)).rejects.toMatchObject({ status: 401 });
			expect(await auth.authorizeDocuments(published.id, session.token)).toMatchObject({ scope: { appId, environment: "published" } });
			await apps.revokeUse(appId, "alice", "carol"); expect(await auth.authorizeDocuments(published.id, session.token)).toBeNull();
		} finally { controller.close(); observed.mockRestore(); ssm.send.mockReset(); }
	});
	it("projects manager-only current selections and unavailable prepared credentials without runtime secrets", async () => {
		const value = await registration(); const expiresAt = Math.floor(Date.now() / 1000) * 1000 + 600000;
		const refs = [{ runtimeId: value.input.id, bindingId: binding.id, credentialId: value.key.id }];
		await client.query("update public.app_gateway_service_credentials set expires_at=to_timestamp($2::double precision/1000) where id=$1", [value.key.id, expiresAt]);
		expect(await store.review(appId, "alice", refs, expiresAt)).toEqual({ selected: [], unavailable: [] });
		await store.register(value.input); await store.activate(value.input.id, "alice", null);
		expect(await store.review(appId, "bob", refs, expiresAt)).toEqual({ selected: [{ environment: "preview", runtimeId: value.input.id, generation: 1 }], unavailable: [] });
		await expect(store.review(appId, "carol", refs, expiresAt)).rejects.toMatchObject({ status: 403 });
		expect((await store.review(appId, "alice", refs, expiresAt + 1000)).unavailable).toEqual([value.input.id]);
		await store.deactivate(appId, "preview", "alice", value.input.id); expect(await store.review(appId, "alice", refs, expiresAt)).toEqual({ selected: [], unavailable: [value.input.id] });
	});
	it("loads an actual selected SQL runtime/key and keeps a colleague's document access revocable", async () => {
		const target = await store.createBinding(appId, "published", "alice"); await apps.grantUse(appId, "alice", "carol");
		const live = await liveRegisteredRuntime(target);
		try {
			const session = await sessionFor(target, "carol"); const scopes: string[] = [];
			const route = await live.loader.load(new AbortController().signal, async (url, init) => {
				const principal = await authenticateGateway(pool, new Headers(init.headers).get("authorization"));
				if (url.pathname !== "/api/gateway/documents") throw new Error("Unexpected fixture endpoint.");
				const body: { token: string } = JSON.parse(String(init.body)); const authorized = await auth.authorizeDocuments(principal.bindingId, body.token);
				if (!authorized) return Response.json({}, { status: 403 }); scopes.push(authorized.scope.environment);
				return Response.json({ document: null }); // Storage itself is covered by the separate real DynamoDB Local suite.
			}, configuration => tlsConnect({ ...configuration, host: "127.0.0.1" }));
			const request = () => new Request(target.origin + "/__smartdeploy/documents", { method: "POST", headers: {
				origin: target.origin, "sec-fetch-site": "same-origin", "content-type": "application/json", cookie: `${GATEWAY_SESSION_COOKIE}=${session.token}` },
				body: JSON.stringify({ action: "get", collection: "notes", id: "shared" }) });
			expect((await route.handle(request())).status).toBe(200); expect(scopes).toEqual(["published"]);
			await apps.revokeUse(appId, "alice", "carol"); expect((await route.handle(request())).status).toBe(403); expect(scopes).toEqual(["published"]);
		} finally { live.loader.close(); }
	});
	it("cannot load a route unpublished while its SSM credential response is pending", async () => {
		const live = await liveRegisteredRuntime(binding);
		try {
			ssm.send.mockImplementationOnce(async () => { await store.deactivate(appId, "preview", "alice", live.input.id); return live.response; });
			await expect(live.loader.load(new AbortController().signal, undefined, configuration => tlsConnect({ ...configuration, host: "127.0.0.1" }))).rejects.toThrow("Private app gateway configuration unavailable.");
			expect(await store.current(appId, "preview")).toBeNull();
		} finally { live.loader.close(); }
	});
	async function sessionFor(target: RuntimeBinding, userId: string) {
		const verifier = randomBytes(32).toString("base64url");
		const handoff = await auth.issue(target.id, { userId, sessionId: userId + "-session" }, createHash("sha256").update(verifier).digest("base64url"));
		return auth.redeem(target.id, handoff.callbackUrl, handoff.code, verifier);
	}
	it("derives document app/environment scope from a current managed runtime session", async () => {
		const { input } = await registration(); await store.register(input); await store.activate(input.id, "alice", null);
		const session = await sessionFor(binding, "alice");
		expect(await auth.authorizeDocuments(binding.id, session.token)).toEqual({ identity: { id: "alice", email: "alice@example.test" }, scope: { appId, environment: "preview" } });
		const other = await store.createBinding(appId, "published", "alice");
		expect(await auth.authorizeDocuments(other.id, session.token)).toBeNull();
		await store.deactivate(appId, "preview", "alice", input.id);
		expect(await auth.authorizeDocuments(binding.id, session.token)).toBeNull();
	});
	it("reauthorizes published member documents after grant, verification and platform-session changes", async () => {
		const published = await store.createBinding(appId, "published", "alice");
		const { input } = await registration(published); await store.register(input); await store.activate(input.id, "alice", null);
		await apps.grantUse(appId, "alice", "carol");
		let session = await sessionFor(published, "carol");
		const expected = { identity: { id: "carol", email: "carol@example.test" }, scope: { appId, environment: "published" } };
		expect(await auth.authorizeDocuments(published.id, session.token)).toEqual(expected);
		await apps.revokeUse(appId, "alice", "carol");
		expect(await auth.authorizeDocuments(published.id, session.token)).toBeNull();
		await apps.grantUse(appId, "alice", "carol");
		expect(await auth.authorizeDocuments(published.id, session.token)).toBeNull();
		session = await sessionFor(published, "carol");
		expect(await auth.authorizeDocuments(published.id, session.token)).toEqual(expected);
		await client.query('update public."user" set "emailVerified"=false where id=\'carol\'');
		expect(await auth.authorizeDocuments(published.id, session.token)).toBeNull();
		await client.query('update public."user" set "emailVerified"=true where id=\'carol\'');
		expect(await auth.authorizeDocuments(published.id, session.token)).toBeNull();
		session = await sessionFor(published, "carol");
		expect(await auth.authorizeDocuments(published.id, session.token)).toEqual(expected);
		await client.query("delete from public.session where id='carol-session'");
		expect(await auth.authorizeDocuments(published.id, session.token)).toBeNull();
	});
	it("keeps legacy session authorization compatible while denying its document projection", async () => {
		const legacy = { ...binding, id: randomUUID(), origin: "https://legacy.apps.example.test" };
		await client.query("insert into public.app_gateway_bindings(id,app_id,origin,environment) values($1,$2,$3,'preview')", [legacy.id, appId, legacy.origin]);
		const session = await sessionFor(legacy, "alice");
		expect(await auth.authorize(legacy.id, session.token)).toEqual({ id: "alice", email: "alice@example.test" });
		expect(await auth.authorizeDocuments(legacy.id, session.token)).toBeNull();
	});
	it("prepares only pinned release metadata without configuration or secret values", async () => {
		const { input, deploymentId } = await registration();
		const prepared = await store.prepare(binding.id, input.releaseId, "bob");
		expect(prepared).toEqual({ binding, releaseId: input.releaseId, deploymentId,
			imageReference: `${scope.accountId}.dkr.ecr.${scope.region}.amazonaws.com/pilot/tracker@${digest}`,
			imageDigest: digest, sourceFingerprint: input.expectedSourceFingerprint });
		expect(prepared.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(prepared)).not.toContain("preview-secret");
		expect(prepared).not.toHaveProperty("deployConfig");
	});
	it.each(["carol", "dave"])("denies preflight by %s", async (actorId) => {
		const { input } = await registration();
		await expect(store.prepare(binding.id, input.releaseId, actorId)).rejects.toMatchObject({ status: actorId === "carol" ? 403 : 404 });
	});
	it("requires current verification before preparing even an owner's release", async () => {
		const { input } = await registration();
		await client.query('update public."user" set "emailVerified"=false where id=\'alice\'');
		await expect(store.prepare(binding.id, input.releaseId, "alice")).rejects.toMatchObject({ status: 403 });
	});
	it("rejects a changed config even when the pinned image remains identical", async () => {
		const { input } = await registration();
		await client.query("update public.deployment_runs set release_artifact=jsonb_set(release_artifact,'{deployConfig,newRuntimeOption}','\"changed\"') where id=$1", [input.releaseId]);
		await expect(store.register(input)).rejects.toMatchObject({ status: 409 });
		expect((await client.query("select count(*)::int as count from public.app_runtime_registrations")).rows[0].count).toBe(0);
		const prepared = await store.prepare(binding.id, input.releaseId, "alice");
		expect(prepared.sourceFingerprint).not.toBe(input.expectedSourceFingerprint);
		expect(prepared.imageDigest).toBe(input.observedImageDigest);
		expect((await store.register({ ...input, expectedSourceFingerprint: prepared.sourceFingerprint })).id).toBe(input.id);
	});
	it("keeps canonical fingerprints stable across JSON ordering and completion timestamp refreshes", async () => {
		const { input, artifact } = await registration();
		const reordered: Record<string, unknown> = Object.fromEntries(Object.entries(artifact).reverse());
		reordered.deployConfig = Object.fromEntries(Object.entries(artifact.deployConfig).reverse());
		await client.query("update public.deployment_runs set release_artifact=$2, finished_at=finished_at+interval '1 second' where id=$1", [input.releaseId, JSON.stringify(reordered)]);
		expect((await store.prepare(binding.id, input.releaseId, "alice")).sourceFingerprint).toBe(input.expectedSourceFingerprint);
		expect((await store.register(input)).id).toBe(input.id);
	});
	it("binds the fingerprint to the deployment association as well as its artifact", async () => {
		const { input, deploymentId } = await registration();
		await client.query("update public.deployments set owner_id='bob' where id=$1", [deploymentId]);
		await expect(store.register(input)).rejects.toMatchObject({ status: 409 });
		expect((await store.prepare(binding.id, input.releaseId, "bob")).sourceFingerprint).not.toBe(input.expectedSourceFingerprint);
	});
	it("rejects replay of a preview fingerprint into published runtime context", async () => {
		const preview = await registration();
		const published = await registration(await store.createBinding(appId, "published", "alice"));
		await expect(store.register({ ...published.input, expectedSourceFingerprint: preview.input.expectedSourceFingerprint })).rejects.toMatchObject({ status: 409 });
		expect((await store.register(published.input)).id).toBe(published.input.id);
	});
	it.each([undefined, "", "a".repeat(63), "A".repeat(64)])("requires an explicit valid source fingerprint (%s)", async (expectedSourceFingerprint) => {
		const { input } = await registration();
		await expect(store.register({ ...input, expectedSourceFingerprint } as RuntimeRegistrationInput)).rejects.toMatchObject({ status: 400 });
	});
	it("is additive/rerunnable and keeps legacy gateway authentication working", async () => {
		await client.query(migration);
		expect((await client.query("select app_environment from public.deployments where id='deploy-a'")).rows[0].app_environment).toBeNull();
		const legacy = (await client.query<{ id: string }>("insert into public.app_gateway_bindings(app_id,origin) values ($1,'https://legacy.example.test') returning id", [appId])).rows[0].id;
		const key = createGatewayServiceCredential(); await client.query("insert into public.app_gateway_service_credentials(id,binding_id,secret_hash,expires_at) values($1,$2,$3,clock_timestamp()+interval '1 hour')", [key.id, legacy, key.secretHash]);
		expect(await authenticateGateway(pool, "Bearer " + key.token)).toEqual({ bindingId: legacy });
	});
	it("keeps a pending managed binding and its key unusable until activation", async () => {
		const { input, key } = await registration(); await store.register(input);
		expect(await store.current(appId, "preview")).toBeNull();
		await expect(auth.inspect(binding.id, { userId: "alice", sessionId: "alice-session" })).rejects.toMatchObject({ status: 401 });
		await expect(authenticateGateway(pool, "Bearer " + key.token)).rejects.toMatchObject({ status: 401 });
	});
	it("registers idempotently without copying configuration or secrets", async () => {
		const { input } = await registration(); const first = await store.register(input); expect(await store.register(input)).toEqual(first);
		expect(JSON.stringify(first)).not.toContain("preview-secret"); expect(first).not.toHaveProperty("deployConfig");
		await expect(store.register({ ...input, privateIp: "10.0.1.24" })).rejects.toMatchObject({ status: 409 });
	});
	it.each(["image", "task", "address", "environment", "unfinished", "failed", "provider", "source"])("rejects mismatched %s evidence", async (kind) => {
		const { input } = await registration();
		if (kind === "image") input.observedImageDigest = "sha256:" + "b".repeat(64);
		if (kind === "task") input.taskArn = input.taskArn.replace("task/pilot/", "task/other/");
		if (kind === "address") input.privateIp = "169.254.169.254";
		if (kind === "environment") await client.query("update public.deployments set app_environment='published' where id=(select release_artifact->'deployConfig'->>'id' from public.deployment_runs where id=$1)", [input.releaseId]);
		if (kind === "unfinished") await client.query("update public.deployment_runs set finished_at=null where id=$1", [input.releaseId]);
		if (kind === "failed") await client.query("update public.deployment_runs set success=false where id=$1", [input.releaseId]);
		if (kind === "provider") await client.query("update public.deployment_runs set release_artifact=jsonb_set(release_artifact,'{cloudProvider}','\"gcp\"') where id=$1", [input.releaseId]);
		if (kind === "source") await client.query("update public.deployment_runs set commit_sha=$2 where id=$1", [input.releaseId, "b".repeat(40)]);
		await expect(store.register(input)).rejects.toMatchObject({ status: 409 }); expect((await client.query("select count(*)::int as count from public.app_runtime_registrations")).rows[0].count).toBe(0);
	});
	it("rejects releases belonging to another app/workspace", async () => {
		const other = (await apps.createApp(workspaceId, "alice", "Other")).id; const { input } = await registration();
		await client.query("update public.deployment_runs set app_id=$2 where id=$1", [input.releaseId, other]);
		await expect(store.register(input)).rejects.toMatchObject({ status: 409 });
	});
	it("requires a matching live exclusive credential and task", async () => {
		const first = await registration(); await store.register(first.input);
		const second = await registration(); await expect(store.register({ ...second.input, taskArn: first.input.taskArn })).rejects.toMatchObject({ status: 409 });
		await client.query("update public.app_gateway_service_credentials set revoked_at=clock_timestamp() where id=$1", [second.key.id]);
		await expect(store.register(second.input)).rejects.toMatchObject({ status: 409 });
	});
	it.each(["carol", "dave"])("denies activation by %s", async (actorId) => {
		const { input } = await registration(); await store.register(input); await expect(store.activate(input.id, actorId, null)).rejects.toMatchObject({ status: actorId === "carol" ? 403 : 404 }); expect(await store.current(appId, "preview")).toBeNull();
	});
	it("requires current email verification even for the owner", async () => {
		const { input } = await registration(); await store.register(input); await client.query('update public."user" set "emailVerified"=false where id=\'alice\'');
		await expect(store.activate(input.id, "alice", null)).rejects.toMatchObject({ status: 403 });
	});
	it("activates, replaces atomically and rejects a stale gateway key", async () => {
		const first = await registration(); await store.register(first.input);
		expect(await store.activate(first.input.id, "bob", null)).toEqual({ runtimeId: first.input.id, generation: 1 });
		expect(await authenticateGateway(pool, "Bearer " + first.key.token)).toEqual({ bindingId: binding.id });
		const second = await registration(); await store.register(second.input);
		await expect(store.activate(second.input.id, "alice", null)).rejects.toMatchObject({ status: 409 });
		expect(await store.activate(second.input.id, "alice", first.input.id)).toEqual({ runtimeId: second.input.id, generation: 2 });
		expect(await store.activate(second.input.id, "alice", first.input.id)).toEqual({ runtimeId: second.input.id, generation: 2 });
		await expect(authenticateGateway(pool, "Bearer " + first.key.token)).rejects.toMatchObject({ status: 401 });
		expect(await authenticateGateway(pool, "Bearer " + second.key.token)).toEqual({ bindingId: binding.id });
		const current = await store.current(appId, "preview"); expect(current?.id).toBe(second.input.id); expect(current?.credentialParameter).toBe(`/smartdeploy/pilot/gateways/${binding.id}/${second.input.id}`); expect(JSON.stringify(current)).not.toContain("preview-secret");
	});
	it("isolates preview and published selections and gateway keys", async () => {
		const preview = await registration(); await store.register(preview.input); await store.activate(preview.input.id, "alice", null);
		const publishedBinding = await store.createBinding(appId, "published", "alice"); const published = await registration(publishedBinding); await store.register(published.input); await store.activate(published.input.id, "alice", null);
		expect((await store.current(appId, "preview"))?.id).toBe(preview.input.id); expect((await store.current(appId, "published"))?.id).toBe(published.input.id);
		expect(await authenticateGateway(pool, "Bearer " + preview.key.token)).toEqual({ bindingId: binding.id }); expect(await authenticateGateway(pool, "Bearer " + published.key.token)).toEqual({ bindingId: publishedBinding.id });
	});
	it("keeps app sessions across replacement but denies them after unpublishing", async () => {
		const first = await registration(); await store.register(first.input); await store.activate(first.input.id, "alice", null);
		const principal = { userId: "alice", sessionId: "alice-session" }; const verifier = randomBytes(32).toString("base64url");
		const display = await auth.inspect(binding.id, principal);
		const handoff = await auth.issue(binding.id, principal, createHash("sha256").update(verifier).digest("base64url"), display.identity);
		const session = await auth.redeem(binding.id, handoff.callbackUrl, handoff.code, verifier);
		expect(await auth.authorize(binding.id, session.token)).toEqual({ id: "alice", email: "alice@example.test" });
		const second = await registration(); await store.register(second.input); await store.activate(second.input.id, "alice", first.input.id);
		expect(await auth.authorize(binding.id, session.token)).toEqual({ id: "alice", email: "alice@example.test" });
		await store.deactivate(appId, "preview", "alice", second.input.id);
		expect(await auth.authorize(binding.id, session.token)).toBeNull();
	});
	it("deactivates before retirement and never reactivates a retired registration", async () => {
		const { input, key } = await registration(); await store.register(input); await store.activate(input.id, "alice", null);
		await expect(client.query("update public.app_runtime_registrations set retired_at=clock_timestamp() where id=$1", [input.id])).rejects.toMatchObject({ code: "23514" });
		await store.deactivate(appId, "preview", "alice", input.id); expect(await store.current(appId, "preview")).toBeNull();
		await expect(authenticateGateway(pool, "Bearer " + key.token)).rejects.toMatchObject({ status: 401 }); await expect(store.activate(input.id, "alice", null)).rejects.toMatchObject({ status: 409 });
	});
	it("protects registered network identity, release snapshot and deployment environment", async () => {
		const { input, deploymentId } = await registration(); await store.register(input);
		for (const statement of ["update public.app_runtime_registrations set private_ip='10.0.1.24' where id=$1", "update public.deployment_runs set release_artifact='{}' where id=$1"]) await expect(client.query(statement, [statement.includes("deployment_runs") ? input.releaseId : input.id])).rejects.toMatchObject({ code: "23514" });
		await expect(client.query("update public.deployments set app_environment='published' where id=$1", [deploymentId])).rejects.toMatchObject({ code: "23514" });
	});
	it("never recycles a private hostname or converts a previously unclassified binding", async () => {
		await client.query("delete from public.app_gateway_bindings where id=$1", [binding.id]);
		await expect(client.query("insert into public.app_gateway_bindings(id,app_id,origin,environment,runtime_managed) values($1,$2,$3,'preview',true)", [binding.id, appId, binding.origin])).rejects.toMatchObject({ code: "23505" });
		const legacy = (await client.query<{ id: string }>("insert into public.app_gateway_bindings(app_id,origin) values($1,'https://old.example.test') returning id", [appId])).rows[0].id;
		await expect(client.query("update public.app_gateway_bindings set runtime_managed=true where id=$1", [legacy])).rejects.toMatchObject({ code: "23514" });
	});
	it("does not downgrade active-only policy when baseline credential migrations rerun", async () => {
		const { input, key } = await registration(); await store.register(input);
		for (const name of ["app_gateway_auth", "gateway_service_credentials"]) await client.query(readFileSync(new URL(`../../supabase/migrations/20261023_${name}.sql`, import.meta.url), "utf8"));
		await expect(authenticateGateway(pool, "Bearer " + key.token)).rejects.toMatchObject({ status: 401 }); await expect(auth.inspect(binding.id, { userId: "alice", sessionId: "alice-session" })).rejects.toMatchObject({ status: 401 });
	});
	it("does not adopt live deployments or copy an existing legacy secret reference", async () => {
		await expect(store.associateDraft("deploy-a", appId, "published", "alice")).rejects.toMatchObject({ status: 409 });
		await client.query("insert into public.deployments(id,repo_name,service_name,owner_id,secrets_arn) values('secret-draft','acme/secret','web','alice','keep-this-reference')");
		await expect(store.associateDraft("secret-draft", appId, "published", "alice")).rejects.toMatchObject({ status: 409 }); expect((await client.query("select secrets_arn from public.deployments where id='secret-draft'")).rows[0].secrets_arn).toBe("keep-this-reference");
	});
	it("serializes competing selections so exactly one compare-and-swap succeeds", async () => {
		const first = await registration(); const second = await registration(); await store.register(first.input); await store.register(second.input);
		const results = await Promise.allSettled([store.activate(first.input.id, "alice", null), store.activate(second.input.id, "bob", null)]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find((result) => result.status === "rejected"); expect(rejected?.status === "rejected" && rejected.reason.status).toBe(409);
		const current = await store.current(appId, "preview"); expect([first.input.id, second.input.id]).toContain(current?.id); expect(current?.generation).toBe(1);
	});
	it("protects a source update that was waiting while registration committed", async () => {
		const { input } = await registration(); const updater = new Client({ connectionString: databaseTestConnectionString(), statement_timeout: 5000 }); await updater.connect();
		const updaterPid = (await updater.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
		await client.query(`create function public.test_hold_runtime_insert() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(619251); return NEW; end $$;
      create trigger test_hold_runtime before insert on public.app_runtime_registrations for each row execute function public.test_hold_runtime_insert()`);
		await client.query("select pg_advisory_lock(619251)");
		let registering: Promise<unknown> | null = null; let changing: Promise<string> | null = null;
		try {
			registering = store.register(input);
			await vi.waitFor(async () => expect((await client.query("select count(*)::int as count from pg_stat_activity where application_name='runtime-registration-tests' and wait_event='advisory'")).rows[0].count).toBe(1));
			changing = updater.query("update public.deployment_runs set release_artifact='{}' where id=$1", [input.releaseId]).then(() => "mutated", (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code) : "unknown");
			await vi.waitFor(async () => expect((await client.query("select count(*)::int as count from pg_stat_activity where pid=$1 and wait_event_type='Lock'", [updaterPid])).rows[0].count).toBe(1));
			await client.query("select pg_advisory_unlock(619251)"); await registering; expect(await changing).toBe("23514");
		} finally { await client.query("select pg_advisory_unlock_all()"); await registering?.catch(() => {}); await changing; await updater.end(); }
	});
	it("keeps registration/routing writes inaccessible to client and service roles", async () => {
		const { input, key } = await registration(); await store.register(input); await store.activate(input.id, "alice", null);
		await client.query("grant usage on schema public to foundation_client, service_role");
		await client.query("begin");
		try {
			await client.query("set local role service_role");
			expect((await client.query("select public.app_gateway_binding_available($1) as available", [binding.id])).rows[0].available).toBe(true);
			expect((await client.query("select binding_id from public.authenticate_app_gateway_credential($1,$2)", [key.id, key.secretHash])).rows).toEqual([{ binding_id: binding.id }]);
		} finally { await client.query("rollback"); }
		for (const role of ["foundation_client", "service_role"]) {
			await client.query("begin");
			try { await client.query(`set local role ${role}`); await expect(client.query("delete from public.app_runtime_routes")).rejects.toMatchObject({ code: "42501" }); }
			finally { await client.query("rollback"); }
		}
		await client.query("begin");
		try { await client.query("set local role foundation_client"); await expect(client.query("select * from public.authenticate_app_gateway_credential($1,$2)", [randomUUID(), "a".repeat(64)])).rejects.toMatchObject({ code: "42501" }); }
		finally { await client.query("rollback"); }
	});
});
