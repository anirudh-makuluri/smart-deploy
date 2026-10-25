-- Operator-provisioned credentials for trusted gateways, never app containers.
-- Requires app_gateway_auth. No credential or runtime is provisioned here.
begin;
create table if not exists public.app_gateway_service_credentials (
  id uuid primary key,
  binding_id uuid not null references public.app_gateway_bindings(id) on delete cascade,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null check (expires_at > created_at),
  revoked_at timestamptz
);
create index if not exists app_gateway_service_credentials_binding on public.app_gateway_service_credentials(binding_id);
alter table public.app_gateway_service_credentials enable row level security;
revoke all on public.app_gateway_service_credentials from public, service_role;
grant select on public.app_gateway_service_credentials to service_role;

-- Install the baseline only once. Later migrations may strengthen the policy;
-- rerunning this file must not replace that stronger implementation.
do $migration$
begin
  if to_regprocedure('public.authenticate_app_gateway_credential(uuid,text)') is null then
    execute $ddl$
      create function public.authenticate_app_gateway_credential(p_id uuid, p_hash text)
      returns table (binding_id uuid) language sql
      set search_path = pg_catalog, public as $function$
        select c.binding_id from public.app_gateway_service_credentials c
        join public.app_gateway_bindings b on b.id = c.binding_id and b.disabled_at is null
        where c.id = p_id and c.secret_hash = p_hash and c.revoked_at is null
          and c.expires_at > clock_timestamp()
      $function$
    $ddl$;
  end if;
end $migration$;
revoke all on function public.authenticate_app_gateway_credential(uuid, text) from public;
grant execute on function public.authenticate_app_gateway_credential(uuid, text) to service_role;
commit;
