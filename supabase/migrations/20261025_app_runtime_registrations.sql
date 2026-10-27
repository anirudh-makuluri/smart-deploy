-- Control-plane metadata only. No cloud resource, private origin cutover or data copy.
-- Requires gateway_service_credentials, gateway_environments and app_workspaces.
begin;
alter table public.deployments add column if not exists app_environment text
  check (app_environment is null or (app_environment in ('preview', 'published') and app_id is not null and workspace_id is not null));
alter table public.app_gateway_bindings add column if not exists runtime_managed boolean not null default false;
create unique index if not exists app_gateway_binding_context on public.app_gateway_bindings(id, app_id, environment);
create unique index if not exists app_gateway_credential_binding on public.app_gateway_service_credentials(id, binding_id);
create unique index if not exists deployment_run_app_context on public.deployment_runs(id, app_id, workspace_id);

-- Public hostname tombstones contain no user/app data and survive app deletion.
create table if not exists public.app_private_origins (
  origin text primary key,
  reserved_at timestamptz not null default clock_timestamp()
);
create table if not exists public.app_runtime_registrations (
  id uuid primary key,
  app_id uuid not null,
  workspace_id uuid not null,
  binding_id uuid not null,
  environment text not null check (environment in ('preview', 'published')),
  release_id uuid not null,
  deployment_id text not null references public.deployments(id) on delete restrict,
  credential_id uuid not null unique,
  task_arn text not null unique,
  private_ip inet not null check (family(private_ip) = 4 and masklen(private_ip) = 32
    and (private_ip <<= inet '10.0.0.0/8' or private_ip <<= inet '172.16.0.0/12' or private_ip <<= inet '192.168.0.0/16')),
  port integer not null check (port between 1 and 65535),
  certificate_pem text not null check (octet_length(certificate_pem) between 1 and 8192),
  registered_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz check (retired_at >= registered_at),
  unique (id, app_id, environment),
  foreign key (app_id, workspace_id) references public.apps(id, workspace_id) on delete restrict,
  foreign key (binding_id, app_id, environment) references public.app_gateway_bindings(id, app_id, environment) on delete restrict,
  foreign key (release_id, app_id, workspace_id) references public.deployment_runs(id, app_id, workspace_id) on delete restrict,
  foreign key (credential_id, binding_id) references public.app_gateway_service_credentials(id, binding_id) on delete restrict
);
create table if not exists public.app_runtime_routes (
  app_id uuid not null,
  environment text not null,
  runtime_id uuid not null,
  generation integer not null default 1 check (generation > 0),
  activated_by text not null references public."user"(id) on delete restrict,
  activated_at timestamptz not null default clock_timestamp(),
  primary key (app_id, environment),
  foreign key (runtime_id, app_id, environment) references public.app_runtime_registrations(id, app_id, environment) on delete restrict
);
create index if not exists app_runtime_binding on public.app_runtime_registrations(binding_id);
create index if not exists app_runtime_release on public.app_runtime_registrations(release_id);

create or replace function public.protect_private_runtime_binding() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if TG_OP = 'INSERT' and NEW.runtime_managed then
    if NEW.origin !~ ('^https://' || NEW.id::text || '\.[a-z0-9.-]+$') then
      raise exception 'Private origin must be allocated for its binding' using errcode = '23514';
    end if;
    insert into public.app_private_origins(origin) values (NEW.origin);
  elsif TG_OP = 'UPDATE' then
    if OLD.runtime_managed and row(NEW.id, NEW.app_id, NEW.origin, NEW.environment, NEW.runtime_managed)
      is distinct from row(OLD.id, OLD.app_id, OLD.origin, OLD.environment, OLD.runtime_managed) then
      raise exception 'Private binding identity is immutable' using errcode = '23514';
    end if;
    if not OLD.runtime_managed and NEW.runtime_managed then
      raise exception 'Private origins must be created fresh' using errcode = '23514';
    end if;
  end if;
  return NEW;
end $$;
create or replace trigger private_runtime_binding before insert or update on public.app_gateway_bindings
  for each row execute function public.protect_private_runtime_binding();

create or replace function public.protect_runtime_registration() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if row(NEW.id, NEW.app_id, NEW.workspace_id, NEW.binding_id, NEW.environment, NEW.release_id,
    NEW.deployment_id, NEW.credential_id, NEW.task_arn, NEW.private_ip, NEW.port, NEW.certificate_pem, NEW.registered_at)
    is distinct from row(OLD.id, OLD.app_id, OLD.workspace_id, OLD.binding_id, OLD.environment, OLD.release_id,
    OLD.deployment_id, OLD.credential_id, OLD.task_arn, OLD.private_ip, OLD.port, OLD.certificate_pem, OLD.registered_at)
    or (OLD.retired_at is not null and NEW.retired_at is distinct from OLD.retired_at)
    or (NEW.retired_at is not null and exists (select 1 from public.app_runtime_routes where runtime_id = OLD.id)) then
    raise exception 'Registered runtime identity is immutable; deactivate before retirement' using errcode = '23514';
  end if;
  return NEW;
end $$;
create or replace trigger registered_runtime_immutable before update on public.app_runtime_registrations
  for each row execute function public.protect_runtime_registration();

create or replace function public.protect_runtime_source() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if TG_TABLE_NAME = 'deployment_runs' then
    if exists (select 1 from public.app_runtime_registrations where release_id = OLD.id)
      and (row(NEW.id, NEW.user_id, NEW.app_id, NEW.workspace_id, NEW.repo_name, NEW.service_name,
        NEW.commit_sha, NEW.success, NEW.release_artifact)
        is distinct from row(OLD.id, OLD.user_id, OLD.app_id, OLD.workspace_id, OLD.repo_name, OLD.service_name,
        OLD.commit_sha, OLD.success, OLD.release_artifact) or NEW.finished_at is null) then
      raise exception 'Registered release source is immutable' using errcode = '23514';
    end if;
  elsif exists (select 1 from public.app_runtime_registrations where deployment_id = OLD.id)
    and row(NEW.id, NEW.app_id, NEW.workspace_id, NEW.app_environment, NEW.cloud_provider, NEW.deployment_target, NEW.region, NEW.repo_name, NEW.service_name)
      is distinct from row(OLD.id, OLD.app_id, OLD.workspace_id, OLD.app_environment, OLD.cloud_provider, OLD.deployment_target, OLD.region, OLD.repo_name, OLD.service_name) then
    raise exception 'Registered deployment association is immutable' using errcode = '23514';
  end if;
  return NEW;
end $$;
create or replace trigger registered_release_immutable before update on public.deployment_runs
  for each row execute function public.protect_runtime_source();
create or replace trigger registered_deployment_immutable before update on public.deployments
  for each row execute function public.protect_runtime_source();

-- Invoker rights: service_role can authenticate, never register/select a route.
create or replace function public.app_gateway_binding_available(p_id uuid) returns boolean
language sql set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.app_gateway_bindings b where b.id = p_id and b.disabled_at is null
      and (not b.runtime_managed or exists (
        select 1 from public.app_runtime_routes route
        join public.app_runtime_registrations runtime on runtime.id = route.runtime_id
        join public.app_gateway_service_credentials credential on credential.id = runtime.credential_id
          and credential.revoked_at is null and credential.expires_at > clock_timestamp()
        where runtime.binding_id = b.id and runtime.retired_at is null
          and route.app_id = b.app_id and route.environment = b.environment
      ))
  )
$$;
revoke all on function public.app_gateway_binding_available(uuid) from public;
grant execute on function public.app_gateway_binding_available(uuid) to service_role;
create or replace function public.authenticate_app_gateway_credential(p_id uuid, p_hash text)
returns table (binding_id uuid) language sql set search_path = pg_catalog, public as $$
  select c.binding_id from public.app_gateway_service_credentials c
  join public.app_gateway_bindings b on b.id = c.binding_id and b.disabled_at is null
  where c.id = p_id and c.secret_hash = p_hash and c.revoked_at is null and c.expires_at > clock_timestamp()
    and (not b.runtime_managed or exists (
      select 1 from public.app_runtime_routes route
      join public.app_runtime_registrations runtime on runtime.id = route.runtime_id
      where runtime.binding_id = b.id and runtime.credential_id = c.id and runtime.retired_at is null
        and route.app_id = b.app_id and route.environment = b.environment
    ))
$$;
revoke all on function public.authenticate_app_gateway_credential(uuid, text) from public;
grant execute on function public.authenticate_app_gateway_credential(uuid, text) to service_role;
revoke all on function public.protect_private_runtime_binding(), public.protect_runtime_registration(), public.protect_runtime_source() from public;
alter table public.app_private_origins enable row level security;
alter table public.app_runtime_registrations enable row level security;
alter table public.app_runtime_routes enable row level security;
revoke all on public.app_private_origins, public.app_runtime_registrations, public.app_runtime_routes from public, service_role;
grant select on public.app_runtime_registrations, public.app_runtime_routes to service_role;
commit;
