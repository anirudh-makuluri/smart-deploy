-- Requires 20261023_app_workspaces.sql. No invitations are sent by this migration.
begin;
create table if not exists public.app_workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  role text not null check (role in ('admin', 'member')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by text not null references public."user"(id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  accepted_at timestamptz,
  accepted_by text references public."user"(id) on delete restrict,
  revoked_at timestamptz,
  check (expires_at > created_at),
  check ((accepted_at is null) = (accepted_by is null)),
  check (accepted_at is null or revoked_at is null)
);
create unique index if not exists app_workspace_invitations_pending_email
  on public.app_workspace_invitations(workspace_id, email)
  where accepted_at is null and revoked_at is null;
create index if not exists app_workspace_invitations_inviter
  on public.app_workspace_invitations(invited_by) where accepted_at is null and revoked_at is null;
alter table public.app_workspace_invitations enable row level security;
revoke all on public.app_workspace_invitations from public;
grant all on public.app_workspace_invitations to service_role;
commit;
