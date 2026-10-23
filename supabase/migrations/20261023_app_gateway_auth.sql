-- Server-only primitives, not a runtime cutover. Requires app_use_grants.
begin;
create table if not exists public.app_gateway_bindings (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  origin text not null unique check (origin ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
  disabled_at timestamptz,
  unique (id, app_id)
);
create table if not exists public.app_gateway_codes (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  binding_id uuid not null,
  app_id uuid not null,
  user_id text not null references public."user"(id) on delete cascade,
  challenge text not null check (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  foreign key (binding_id, app_id) references public.app_gateway_bindings(id, app_id) on delete cascade,
  check (expires_at > created_at and expires_at <= created_at + interval '2 minutes')
);
create table if not exists public.app_gateway_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  binding_id uuid not null,
  app_id uuid not null,
  user_id text not null references public."user"(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  foreign key (binding_id, app_id) references public.app_gateway_bindings(id, app_id) on delete cascade,
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour')
);
create index if not exists app_gateway_bindings_app on public.app_gateway_bindings(app_id);
create index if not exists app_gateway_codes_subject on public.app_gateway_codes(app_id, user_id);
create index if not exists app_gateway_sessions_subject on public.app_gateway_sessions(app_id, user_id);
create index if not exists app_gateway_codes_user on public.app_gateway_codes(user_id);
create index if not exists app_gateway_sessions_user on public.app_gateway_sessions(user_id);
create index if not exists app_gateway_codes_binding on public.app_gateway_codes(binding_id);
create index if not exists app_gateway_sessions_binding on public.app_gateway_sessions(binding_id);
create index if not exists app_gateway_codes_expiry on public.app_gateway_codes(expires_at);
create index if not exists app_gateway_sessions_expiry on public.app_gateway_sessions(expires_at);

-- Permanently invalidate credentials on policy changes, including revoke/regrant
-- without an intervening authorization request. Functions execute as the caller.
create or replace function public.invalidate_app_gateway_access() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if TG_TABLE_NAME = 'app_use_grants' then
    delete from public.app_gateway_codes where app_id = OLD.app_id and user_id = OLD.user_id;
    delete from public.app_gateway_sessions where app_id = OLD.app_id and user_id = OLD.user_id;
  elsif TG_TABLE_NAME = 'app_workspace_members' then
    delete from public.app_gateway_codes c using public.apps a where c.app_id = a.id and a.workspace_id = OLD.workspace_id and c.user_id = OLD.user_id;
    delete from public.app_gateway_sessions s using public.apps a where s.app_id = a.id and a.workspace_id = OLD.workspace_id and s.user_id = OLD.user_id;
  elsif TG_TABLE_NAME = 'app_workspaces' then
    delete from public.app_gateway_codes c using public.apps a where c.app_id = a.id and a.workspace_id = OLD.id;
    delete from public.app_gateway_sessions s using public.apps a where s.app_id = a.id and a.workspace_id = OLD.id;
  elsif TG_TABLE_NAME = 'user' then
    delete from public.app_gateway_codes where user_id = OLD.id;
    delete from public.app_gateway_sessions where user_id = OLD.id;
  elsif TG_TABLE_NAME = 'app_gateway_bindings' then
    delete from public.app_gateway_codes where binding_id = OLD.id;
    delete from public.app_gateway_sessions where binding_id = OLD.id;
  elsif TG_TABLE_NAME = 'apps' then
    delete from public.app_gateway_codes where app_id = OLD.id;
    delete from public.app_gateway_sessions where app_id = OLD.id;
  end if;
  return null;
end $$;
create or replace trigger app_gateway_grant_revocation after delete on public.app_use_grants
  for each row execute function public.invalidate_app_gateway_access();
create or replace trigger app_gateway_membership_removal after delete on public.app_workspace_members
  for each row execute function public.invalidate_app_gateway_access();
create or replace trigger app_gateway_role_change after update of role on public.app_workspace_members
  for each row when (OLD.role is distinct from NEW.role) execute function public.invalidate_app_gateway_access();
create or replace trigger app_gateway_owner_change after update of owner_id on public.app_workspaces
  for each row when (OLD.owner_id is distinct from NEW.owner_id) execute function public.invalidate_app_gateway_access();
create or replace trigger app_gateway_workspace_change after update of workspace_id on public.apps
  for each row when (OLD.workspace_id is distinct from NEW.workspace_id) execute function public.invalidate_app_gateway_access();
create or replace trigger app_gateway_identity_change after update of email, "emailVerified" on public."user"
  for each row when (OLD.email is distinct from NEW.email or OLD."emailVerified" is distinct from NEW."emailVerified")
  execute function public.invalidate_app_gateway_access();
create or replace trigger app_gateway_binding_change after update of origin, disabled_at on public.app_gateway_bindings
  for each row when (OLD.origin is distinct from NEW.origin or OLD.disabled_at is distinct from NEW.disabled_at)
  execute function public.invalidate_app_gateway_access();

alter table public.app_gateway_bindings enable row level security;
alter table public.app_gateway_codes enable row level security;
alter table public.app_gateway_sessions enable row level security;
revoke all on public.app_gateway_bindings, public.app_gateway_codes, public.app_gateway_sessions from public;
revoke all on public.app_gateway_bindings from service_role;
grant select on public.app_gateway_bindings to service_role;
-- Allows row locking and emergency disable/re-enable, not origin/app registration.
grant update (disabled_at) on public.app_gateway_bindings to service_role;
revoke all on public.app_gateway_codes, public.app_gateway_sessions from service_role;
grant select, insert, delete on public.app_gateway_codes, public.app_gateway_sessions to service_role;
revoke all on function public.invalidate_app_gateway_access() from public;
commit;
