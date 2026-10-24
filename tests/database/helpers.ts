import { readFileSync } from "node:fs";
import type { Client } from "pg";

export function databaseTestConnectionString(): string {
	const value = process.env.TEST_DATABASE_URL;
	if (!value) throw new Error("TEST_DATABASE_URL is required for database tests.");
	const target = new URL(value);
	if (
		!["postgres:", "postgresql:"].includes(target.protocol)
		|| !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
		|| target.pathname !== "/smartdeploy_foundation_test" || target.search !== ""
	) throw new Error("Database tests require a disposable local smartdeploy_foundation_test database.");
	return value;
}

export async function prepareDatabaseTestRoles(client: Client): Promise<void> {
	await client.query(`
		do $$ begin
		  if not exists (select 1 from pg_roles where rolname = 'service_role') then
		    create role service_role nologin bypassrls;
		  end if;
		  if not exists (select 1 from pg_roles where rolname = 'foundation_client') then
		    create role foundation_client nologin;
		  end if;
		end $$;
	`);
}

export async function resetFoundationDatabase(client: Client): Promise<void> {
	await client.query(`
		drop schema public cascade;
		create schema public;
		create schema if not exists auth;
		create or replace function auth.uid() returns uuid language sql as 'select null::uuid';
		create table public."user" (id text primary key, email text not null unique, "emailVerified" boolean not null default false);
		insert into public."user" (id, email, "emailVerified") values
		  ('alice', 'alice@example.test', true), ('bob', 'bob@example.test', true),
		  ('carol', 'carol@example.test', true), ('dave', 'dave@example.test', false);
		create table public.session (id text primary key, "userId" text not null references public."user"(id) on delete cascade, "expiresAt" timestamptz not null);
		insert into public.session (id, "userId", "expiresAt") select id || '-session', id, clock_timestamp() + interval '1 day' from public."user";
	`);
	await client.query(readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8"));
	await client.query(`
		insert into public.deployments (id, repo_name, service_name, owner_id, cloud_resources)
		values ('deploy-a', 'acme/tracker', 'web', 'alice', '{"target":"ecs","service":"existing-service"}'),
		       ('deploy-b', 'acme/tracker', 'web', 'bob', null);
		insert into public.deployment_runs (user_id, repo_name, service_name, release_artifact)
		values ('alice', 'acme/tracker', 'web', '{"kind":"ecr_image","imageTag":"original"}'),
		       ('bob', 'acme/tracker', 'web', '{}');
	`);
	await client.query(readFileSync(new URL("../../supabase/migrations/20261023_app_workspaces.sql", import.meta.url), "utf8"));
}
