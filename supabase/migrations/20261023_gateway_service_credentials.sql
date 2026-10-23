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
commit;
