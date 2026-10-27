import { SSMClient } from "@aws-sdk/client-ssm";
import type { Pool } from "pg";
import { getAwsClientConfig } from "../aws/sdkClients";
import { PilotRuntimeVerifier } from "../aws/pilotRuntimeVerifier";
import { GatewayUpstreamTls, type GatewayTlsDial } from "../gateway/upstreamTls";
import { privateRuntimeOrigin, type RuntimeScope } from "./runtimeMetadata";
import { AppRuntimeStore } from "./runtimeStore";
import { RuntimeControlRequest, type RuntimeControlView, type RuntimeControlReply } from "./runtimeControlProtocol";
import { RuntimeControlSettings, runtimeControlScope, type RuntimeControlTarget } from "./runtimeControlSettings";
import { verifyPreparedRuntimeCredential } from "./runtimeControlCredential";
import { WorkspaceError } from "./workspaceStore";

export interface RuntimeControlPrincipal { userId: string; sessionId: string }
export type RuntimeControlAuthorization = (principal: RuntimeControlPrincipal) => Promise<void>;

/** Trusted AWS worker control plane. Never provisions or accepts browser AWS metadata. */
export class AppRuntimeController {
	readonly #settings: RuntimeControlSettings;
	readonly #runtimeScope: RuntimeScope;
	readonly #store: AppRuntimeStore;
	readonly #verifier: PilotRuntimeVerifier;
	readonly #ssm: SSMClient;
	readonly #expiry: ReturnType<typeof setTimeout>;
	#pending: AbortController | null = null;
	#closed = false;
	constructor(private readonly pool: Pool, settings: RuntimeControlSettings, private readonly authorize: RuntimeControlAuthorization, private readonly dial: GatewayTlsDial | undefined) {
		this.#settings = RuntimeControlSettings.parse(settings);
		this.#runtimeScope = runtimeControlScope(this.#settings.scope);
		const remaining = this.#settings.expiresAt - Date.now(); if (remaining <= 0 || remaining > 7200000) throw new WorkspaceError(503, "Runtime control unavailable.");
		this.#store = new AppRuntimeStore(pool, this.#runtimeScope); this.#verifier = new PilotRuntimeVerifier(this.#settings.scope);
		this.#ssm = new SSMClient({ ...getAwsClientConfig(settings.scope.region), endpoint: `https://ssm.${settings.scope.region}.amazonaws.com`, maxAttempts: 1,
			requestHandler: { connectionTimeout: 1000, requestTimeout: 1800, throwOnRequestTimeout: true, httpsAgent: { keepAlive: true, maxSockets: 1 } } });
		this.#expiry = setTimeout(() => this.close(), remaining); this.#expiry.unref();
	}
	async #prepare(target: RuntimeControlTarget, actorId: string, signal: AbortSignal) {
		signal.throwIfAborted(); const source = await this.#store.prepare(target.expected.bindingId, target.expected.releaseId, actorId); signal.throwIfAborted();
		if (source.binding.id !== target.expected.bindingId || source.releaseId !== target.expected.releaseId || source.binding.appId !== this.#settings.appId || source.binding.environment !== target.expected.environment
			|| source.binding.origin !== privateRuntimeOrigin(target.expected.bindingId, this.#runtimeScope) || source.imageReference !== target.expected.appImage) throw new WorkspaceError(409, "Runtime catalog changed.");
		return source;
	}
	async #view(actorId: string, signal: AbortSignal): Promise<RuntimeControlView> {
		const settings = this.#settings;
		// Exactly three independent snapshots; the dedicated production pool caps concurrent SQL at two.
		const snapshots = await Promise.allSettled(settings.targets.map(target => this.#prepare(target, actorId, signal)));
		const failures = snapshots.filter(result => result.status === "rejected"); if (failures.length) throw failures[0].reason;
		const review = await this.#store.review(settings.appId, actorId, settings.targets.map(target => ({ runtimeId: target.expected.runtimeId, bindingId: target.expected.bindingId, credentialId: target.credentialId })), settings.expiresAt);
		signal.throwIfAborted();
		const unavailable = new Set(review.unavailable);
		const selected = review.selected.map(row => {
			const target = settings.targets.find(target => target.expected.runtimeId === row.runtimeId && target.expected.environment === row.environment);
			if (!target) throw new WorkspaceError(409, "Runtime catalog changed.");
			return { ...row, releaseId: target.expected.releaseId, origin: privateRuntimeOrigin(target.expected.bindingId, this.#runtimeScope), available: !unavailable.has(row.runtimeId) };
		});
		return { expiresAt: settings.expiresAt, selected, choices: settings.targets.map(target => ({ environment: target.expected.environment, releaseId: target.expected.releaseId, label: target.label, available: !unavailable.has(target.expected.runtimeId) })) };
	}
	async #activate(target: RuntimeControlTarget, principal: RuntimeControlPrincipal, expectedCurrentId: string | null, signal: AbortSignal): Promise<void> {
		if (this.#settings.expiresAt - Date.now() < 30000) throw new WorkspaceError(503, "Demo is ending.");
		const source = await this.#prepare(target, principal.userId, signal);
		const expected = { ...target.expected, appId: source.binding.appId, bindingId: source.binding.id, environment: source.binding.environment, releaseId: source.releaseId, appImage: source.imageReference };
		const checks = await Promise.allSettled([this.#verifier.inspect(expected, signal), verifyPreparedRuntimeCredential(this.pool, this.#ssm, this.#settings, target, signal)]);
		signal.throwIfAborted(); const [observed, credential] = checks;
		if (observed.status === "rejected") throw observed.reason; if (credential.status === "rejected") throw credential.reason;
		const observation = observed.value;
		const socket = await new GatewayUpstreamTls({ bindingId: target.expected.bindingId, environment: target.expected.environment, releaseId: target.expected.releaseId,
			privateIp: observation.privateIp, port: observation.port, certificatePem: target.certificatePem, timeoutMs: 2000, maxConnections: 1 }, this.dial).connect(signal);
		socket.destroy(); signal.throwIfAborted();
		await this.authorize(principal); signal.throwIfAborted();
		const latest = await this.#prepare(target, principal.userId, signal);
		if (latest.sourceFingerprint !== source.sourceFingerprint) throw new WorkspaceError(409, "Release changed after verification.");
		await this.#store.register({ id: target.expected.runtimeId, bindingId: target.expected.bindingId, releaseId: target.expected.releaseId, credentialId: target.credentialId,
			taskArn: observation.taskArn, privateIp: observation.privateIp, port: observation.port, certificatePem: target.certificatePem,
			observedImageDigest: observation.appImageDigest, expectedSourceFingerprint: source.sourceFingerprint });
		signal.throwIfAborted();
		await this.authorize(principal); signal.throwIfAborted();
		if (Date.now() >= this.#settings.expiresAt) throw new WorkspaceError(503, "Demo ended.");
		await this.#store.activate(target.expected.runtimeId, principal.userId, expectedCurrentId); signal.throwIfAborted();
	}
	async request(principal: RuntimeControlPrincipal, payload: unknown, signal: AbortSignal): Promise<RuntimeControlReply> {
		const parsed = RuntimeControlRequest.safeParse(payload);
		const failure = (status: number): RuntimeControlReply => ({ ok: false, requestId: parsed.success ? parsed.data.requestId : null, status, error: "App runtime change could not be confirmed. Refresh the current state before trying again." });
		if (!parsed.success) return failure(400);
		if (this.#closed || this.#pending || signal.aborted || Date.now() >= this.#settings.expiresAt) return failure(503);
		const controller = new AbortController(); this.#pending = controller; const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true });
		let rejectAborted = () => {}; const aborted = new Promise<never>((_, reject) => { rejectAborted = () => reject(new WorkspaceError(503, "Runtime control unavailable.")); });
		controller.signal.addEventListener("abort", rejectAborted, { once: true }); const timer = setTimeout(abort, 15000); timer.unref();
		const work = (async (): Promise<RuntimeControlReply> => {
			await this.authorize(principal); controller.signal.throwIfAborted();
			const command = parsed.data; if (command.appId !== this.#settings.appId) throw new WorkspaceError(404, "App unavailable.");
			if (command.action === "activate") {
				const target = this.#settings.targets.find(target => target.expected.releaseId === command.releaseId && target.expected.environment === command.environment);
				if (!target) throw new WorkspaceError(409, "Release unavailable.");
				await this.#activate(target, principal, command.expectedCurrentId, controller.signal);
			}
			return { ok: true, requestId: command.requestId, appId: command.appId, view: await this.#view(principal.userId, controller.signal) };
		})();
		void work.finally(() => { if (this.#pending === controller) this.#pending = null; }).catch(() => {});
		try { return await Promise.race([work, aborted]); }
		catch (error) { return failure(error instanceof WorkspaceError ? error.status : 503); }
		finally { clearTimeout(timer); signal.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", rejectAborted); controller.abort(); }
	}
	close(): void { if (this.#closed) return; this.#closed = true; clearTimeout(this.#expiry); this.#pending?.abort(); this.#verifier.close(); this.#ssm.destroy(); }
}
