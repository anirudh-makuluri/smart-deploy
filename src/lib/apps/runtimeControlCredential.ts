import { createHash } from "node:crypto";
import { GetParameterCommand, type SSMClient } from "@aws-sdk/client-ssm";
import type { Pool } from "pg";
import { runtimeCredentialParameter } from "./runtimeMetadata";
import type { RuntimeControlSettings, RuntimeControlTarget } from "./runtimeControlSettings";
import { WorkspaceError } from "./workspaceStore";

/** Prepared keys are not yet accepted by authenticateGateway, which requires a selected runtime. */
export async function verifyPreparedRuntimeCredential(pool: Pool, ssm: SSMClient, settings: RuntimeControlSettings, target: RuntimeControlTarget, signal: AbortSignal): Promise<void> {
	const name = runtimeCredentialParameter(target.expected.bindingId, target.expected.runtimeId);
	const parameter = (await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }), { abortSignal: signal })).Parameter;
	signal.throwIfAborted();
	const credential = /^sd_gateway_([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(parameter?.Value ?? "");
	if (parameter?.Type !== "SecureString" || parameter.Name !== name || parameter.ARN !== `arn:aws:ssm:${settings.scope.region}:${settings.scope.accountId}:parameter${name}`
		|| parameter.Version !== 1 || parameter.Selector || !credential || credential[0] !== parameter.Value || credential[1] !== target.credentialId) throw new WorkspaceError(409, "Prepared runtime credential unavailable.");
	const result = await pool.query(`select id from public.app_gateway_service_credentials where id=$1 and binding_id=$2 and secret_hash=$3 and revoked_at is null
      and expires_at > clock_timestamp() and expires_at = to_timestamp($4::double precision / 1000)`,
	[target.credentialId, target.expected.bindingId, createHash("sha256").update(credential[2], "utf8").digest("hex"), settings.expiresAt]);
	signal.throwIfAborted(); if (result.rowCount !== 1) throw new WorkspaceError(409, "Prepared runtime credential unavailable.");
}
