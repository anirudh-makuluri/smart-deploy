import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AppEnvironment } from "./types";
import { loadWorkspaceAccess, requireId, requireWorkspaceManager, withWorkspaceTransaction, WorkspaceError } from "./workspaceStore";
import { privateRuntimeOrigin, runtimeCredentialParameter, runtimeEndpoint, runtimeReleaseSource, RuntimeRegistrationInput, RuntimeScope,
	type AppRuntime, type AppRuntimeRoute, type RuntimeBinding, type RuntimeSource, type RuntimeReleasePreflight, type CurrentAppRuntime } from "./runtimeMetadata";

const FIELDS = `r.id, r.app_id as "appId", r.workspace_id as "workspaceId", r.binding_id as "bindingId", r.environment,
  r.release_id as "releaseId", r.deployment_id as "deploymentId", r.credential_id as "credentialId", r.task_arn as "taskArn",
  host(r.private_ip) as "privateIp", r.port, r.certificate_pem as "certificatePem", r.registered_at as "registeredAt", r.retired_at as "retiredAt"`;

/** Privileged control-plane primitives, never an HTTP/body authentication adapter.
 * Registration requires separately verified AWS task/ENI/SG/container evidence.
 * Management adapters must require a live approved/verified platform principal. */
export class AppRuntimeStore {
	readonly #scope: RuntimeScope;
	constructor(private readonly pool: Pool, scope: RuntimeScope) { this.#scope = RuntimeScope.parse(scope); }

	async #transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
		try { return await withWorkspaceTransaction(this.pool, action); }
		catch (error) {
			if (error instanceof WorkspaceError) throw error;
			if (error && typeof error === "object" && "code" in error && ["23503", "23505", "23514"].includes(String(error.code))) throw new WorkspaceError(409, "Runtime registration conflicts with current state.");
			throw new WorkspaceError(503, "Runtime registration unavailable.");
		}
	}
	async #manager(client: PoolClient, appId: string, actorId: string): Promise<string> {
		requireId(appId);
		const app = await client.query<{ workspaceId: string }>('select workspace_id as "workspaceId" from public.apps where id = $1', [appId]);
		if (!app.rows[0]) throw new WorkspaceError(404, "App unavailable.");
		const workspaceId = app.rows[0].workspaceId;
		requireWorkspaceManager(await loadWorkspaceAccess(client, workspaceId, actorId));
		const verified = await client.query('select id from public."user" where id = $1 and "emailVerified" = true for share', [actorId]);
		if (!verified.rowCount) throw new WorkspaceError(403, "Verified management identity required.");
		return workspaceId;
	}
	async #binding(client: PoolClient, id: string): Promise<RuntimeBinding> {
		requireId(id);
		const lookup = await client.query<{ workspaceId: string }>('select a.workspace_id as "workspaceId" from public.app_gateway_bindings b join public.apps a on a.id = b.app_id where b.id = $1', [id]);
		if (!lookup.rows[0]) throw new WorkspaceError(404, "Runtime binding unavailable.");
		await client.query("select id from public.app_workspaces where id = $1 for update", [lookup.rows[0].workspaceId]);
		const result = await client.query<RuntimeBinding>(`select b.id, b.app_id as "appId", a.workspace_id as "workspaceId", b.origin, b.environment, b.runtime_managed as managed
      from public.app_gateway_bindings b join public.apps a on a.id = b.app_id where b.id = $1 and b.disabled_at is null for share of b, a`, [id]);
		if (!result.rows[0]) throw new WorkspaceError(409, "Runtime binding unavailable.");
		return result.rows[0];
	}

	async createBinding(appId: string, environment: AppEnvironment, actorId: string): Promise<RuntimeBinding> {
		if (!["preview", "published"].includes(environment)) throw new WorkspaceError(400, "Invalid app environment.");
		return this.#transaction(async (client) => {
			const workspaceId = await this.#manager(client, appId, actorId);
			const current = await client.query<{ id: string }>("select id from public.app_gateway_bindings where app_id = $1 and environment = $2 and runtime_managed and disabled_at is null order by id limit 1", [appId, environment]);
			if (current.rows[0]) return this.#binding(client, current.rows[0].id);
			const id = randomUUID(); const origin = privateRuntimeOrigin(id, this.#scope);
			await client.query("insert into public.app_gateway_bindings (id, app_id, origin, environment, runtime_managed) values ($1, $2, $3, $4, true)", [id, appId, origin, environment]);
			return { id, appId, workspaceId, origin, environment, managed: true };
		});
	}

	/** Initial association only: never adopts live infrastructure or a legacy secret. */
	async associateDraft(deploymentId: string, appId: string, environment: AppEnvironment, actorId: string): Promise<void> {
		if (!["preview", "published"].includes(environment)) throw new WorkspaceError(400, "Invalid app environment.");
		await this.#transaction(async (client) => {
			const workspaceId = await this.#manager(client, appId, actorId);
			const result = await client.query(`update public.deployments set app_id = $1, workspace_id = $2, app_environment = $3
        where id = $4 and owner_id = $5 and cloud_resources is null and first_deployment is null and active_run_id is null and secrets_arn is null
        and (app_id is null or (app_id = $1 and workspace_id = $2)) and (app_environment is null or app_environment = $3) returning id`, [appId, workspaceId, environment, deploymentId, actorId]);
			if (!result.rowCount) throw new WorkspaceError(409, "A fresh owned deployment with environment-scoped configuration is required.");
		});
	}

	async #release(client: PoolClient, binding: RuntimeBinding, releaseId: string): Promise<RuntimeReleasePreflight> {
		requireId(releaseId);
		if (!binding.managed || binding.origin !== privateRuntimeOrigin(binding.id, this.#scope)) throw new WorkspaceError(409, "A managed private binding is required.");
		const result = await client.query<RuntimeSource & { canonical: string }>(`select r.id, r.app_id as "appId", r.workspace_id as "workspaceId", r.repo_name as "repoName", r.service_name as "serviceName", r.commit_sha as "commitSha",
      r.success, r.finished_at as "finishedAt", r.release_artifact as artifact,
      jsonb_build_object('id', r.id, 'userId', r.user_id, 'appId', r.app_id, 'workspaceId', r.workspace_id,
        'repo', r.repo_name, 'service', r.service_name, 'commit', r.commit_sha, 'success', r.success,
        'finished', r.finished_at is not null, 'artifact', r.release_artifact)::text as canonical
      from public.deployment_runs r where r.id = $1 for share`, [releaseId]);
		const stored = result.rows[0]; if (!stored) throw new WorkspaceError(409, "Release unavailable.");
		const source = runtimeReleaseSource(stored, binding, this.#scope);
		const deployment = await client.query<{ canonical: string }>(`select jsonb_build_object('id', id, 'ownerId', owner_id,
      'appId', app_id, 'workspaceId', workspace_id, 'environment', app_environment, 'provider', cloud_provider,
      'target', deployment_target, 'region', region, 'repo', repo_name, 'service', service_name)::text as canonical
      from public.deployments where id = $1 and app_id = $2 and workspace_id = $3 and app_environment = $4
      and cloud_provider = 'aws' and deployment_target = 'ecs' and region = $5 and repo_name = $6 and service_name = $7 for share`,
		[source.deploymentId, binding.appId, binding.workspaceId, binding.environment, this.#scope.region, stored.repoName, stored.serviceName]);
		if (!deployment.rows[0]) throw new WorkspaceError(409, "Release deployment environment does not match.");
		const sourceFingerprint = createHash("sha256").update(JSON.stringify([binding.id, binding.appId, binding.workspaceId, binding.environment, binding.origin,
			stored.canonical, deployment.rows[0].canonical])).digest("hex");
		return { binding, releaseId: stored.id, ...source, sourceFingerprint };
	}

	/** Short SQL snapshot for trusted launch preparation; no config/secret values leave history. */
	async prepare(bindingId: string, releaseId: string, actorId: string): Promise<RuntimeReleasePreflight> {
		return this.#transaction(async (client) => {
			const binding = await this.#binding(client, bindingId); await this.#manager(client, binding.appId, actorId);
			return this.#release(client, binding, releaseId);
		});
	}

	async register(input: RuntimeRegistrationInput): Promise<AppRuntime> {
		const parsed = RuntimeRegistrationInput.safeParse(input);
		if (!parsed.success) throw new WorkspaceError(400, "Invalid runtime registration.");
		return this.#transaction(async (client) => {
			const binding = await this.#binding(client, input.bindingId);
			const endpoint = runtimeEndpoint(parsed.data, binding, this.#scope);
			const source = await this.#release(client, binding, input.releaseId);
			if (source.sourceFingerprint !== input.expectedSourceFingerprint) throw new WorkspaceError(409, "Release changed after preflight; prepare it again.");
			if (source.imageDigest !== input.observedImageDigest) throw new WorkspaceError(409, "Observed task image does not match the release.");
			const credential = await client.query("select id from public.app_gateway_service_credentials where id = $1 and binding_id = $2 and revoked_at is null and expires_at > clock_timestamp() for share", [input.credentialId, binding.id]);
			if (!credential.rowCount) throw new WorkspaceError(409, "A live exclusive gateway credential is required.");
			await client.query(`insert into public.app_runtime_registrations(id, app_id, workspace_id, binding_id, environment, release_id, deployment_id, credential_id, task_arn, private_ip, port, certificate_pem)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::inet,$11,$12) on conflict (id) do nothing`,
			[input.id, binding.appId, binding.workspaceId, binding.id, binding.environment, input.releaseId, source.deploymentId, input.credentialId, input.taskArn, input.privateIp, input.port, endpoint.certificatePem]);
			const stored = (await client.query<AppRuntime>(`select ${FIELDS} from public.app_runtime_registrations r where r.id = $1`, [input.id])).rows[0];
			const actual = stored && [stored.bindingId, stored.releaseId, stored.credentialId, stored.taskArn, stored.privateIp, stored.port, stored.certificatePem];
			const expected = [binding.id, input.releaseId.toLowerCase(), input.credentialId.toLowerCase(), input.taskArn, input.privateIp, input.port, endpoint.certificatePem];
			if (!stored || stored.retiredAt || JSON.stringify(actual) !== JSON.stringify(expected)) throw new WorkspaceError(409, "Runtime identifier already belongs to another registration.");
			return stored;
		});
	}

	async activate(runtimeId: string, actorId: string, expectedCurrentId: string | null): Promise<AppRuntimeRoute> {
		requireId(runtimeId); if (expectedCurrentId !== null) requireId(expectedCurrentId);
		return this.#transaction(async (client) => {
			const lookup = await client.query<{ appId: string }>('select app_id as "appId" from public.app_runtime_registrations where id = $1', [runtimeId]);
			if (!lookup.rows[0]) throw new WorkspaceError(404, "Runtime unavailable.");
			await this.#manager(client, lookup.rows[0].appId, actorId);
			const runtime = (await client.query<AppRuntime>(`select ${FIELDS} from public.app_runtime_registrations r join public.app_gateway_bindings b on b.id = r.binding_id
        where r.id = $1 and r.retired_at is null and b.runtime_managed and b.disabled_at is null for update of r, b`, [runtimeId])).rows[0];
			if (!runtime) throw new WorkspaceError(409, "Runtime unavailable.");
			const credential = await client.query("select id from public.app_gateway_service_credentials where id = $1 and revoked_at is null and expires_at > clock_timestamp() for update", [runtime.credentialId]);
			if (!credential.rowCount) throw new WorkspaceError(409, "Runtime gateway credential expired or revoked.");
			const current = (await client.query<AppRuntimeRoute>('select runtime_id as "runtimeId", generation from public.app_runtime_routes where app_id = $1 and environment = $2 for update', [runtime.appId, runtime.environment])).rows[0];
			if (current?.runtimeId === runtime.id) return current;
			const expected = expectedCurrentId === null ? null : expectedCurrentId.toLowerCase();
			if ((current?.runtimeId ?? null) !== expected) throw new WorkspaceError(409, "App runtime changed; refresh before activating.");
			await client.query("update public.app_gateway_bindings set disabled_at = clock_timestamp() where app_id = $1 and environment = $2 and id <> $3 and disabled_at is null", [runtime.appId, runtime.environment, runtime.bindingId]);
			if (current) await client.query("update public.app_gateway_service_credentials set revoked_at = clock_timestamp() where id = (select credential_id from public.app_runtime_registrations where id = $1)", [current.runtimeId]);
			const selected = await client.query<AppRuntimeRoute>(`insert into public.app_runtime_routes(app_id, environment, runtime_id, activated_by) values ($1,$2,$3,$4)
        on conflict (app_id, environment) do update set runtime_id = excluded.runtime_id, generation = app_runtime_routes.generation + 1, activated_by = excluded.activated_by, activated_at = clock_timestamp()
        returning runtime_id as "runtimeId", generation`, [runtime.appId, runtime.environment, runtime.id, actorId]);
			if (current) await client.query("update public.app_runtime_registrations set retired_at = clock_timestamp() where id = $1", [current.runtimeId]);
			return selected.rows[0];
		});
	}

	async deactivate(appId: string, environment: AppEnvironment, actorId: string, expectedCurrentId: string): Promise<void> {
		requireId(expectedCurrentId);
		await this.#transaction(async (client) => {
			await this.#manager(client, appId, actorId);
			const removed = await client.query<{ runtimeId: string }>('delete from public.app_runtime_routes where app_id = $1 and environment = $2 and runtime_id = $3 returning runtime_id as "runtimeId"', [appId, environment, expectedCurrentId]);
			if (!removed.rows[0]) throw new WorkspaceError(409, "App runtime changed; refresh before deactivating.");
			await client.query("update public.app_gateway_service_credentials set revoked_at = clock_timestamp() where id = (select credential_id from public.app_runtime_registrations where id = $1)", [expectedCurrentId]);
			await client.query("update public.app_runtime_registrations set retired_at = clock_timestamp() where id = $1", [expectedCurrentId]);
		});
	}

	/** Operator-only projection. No config or secret values are copied from history. */
	async current(appId: string, environment: AppEnvironment): Promise<CurrentAppRuntime | null> {
		requireId(appId);
		const result = await this.pool.query<AppRuntime & AppRuntimeRoute & { origin: string }>(`select ${FIELDS}, route.runtime_id as "runtimeId", route.generation, b.origin
      from public.app_runtime_routes route join public.app_runtime_registrations r on r.id = route.runtime_id
      join public.app_gateway_bindings b on b.id = r.binding_id and b.runtime_managed and b.disabled_at is null
      join public.app_gateway_service_credentials c on c.id = r.credential_id and c.revoked_at is null and c.expires_at > clock_timestamp()
      where route.app_id = $1 and route.environment = $2 and r.retired_at is null`, [appId, environment]);
		const row = result.rows[0]; return row ? { ...row, credentialParameter: runtimeCredentialParameter(row.bindingId, row.id) } : null;
	}
}
