-- Apply after schema.sql. Additive and rerunnable; no backfill or runtime switch.
begin;

create table if not exists public.app_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  kind text not null check (kind in ('personal', 'team')),
  owner_id text not null references public."user"(id) on delete restrict,
  created_at timestamptz not null default now()
);
create unique index if not exists app_workspaces_personal_owner
  on public.app_workspaces(owner_id) where kind = 'personal';
create index if not exists app_workspaces_owner on public.app_workspaces(owner_id);

create table if not exists public.app_workspace_members (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  user_id text not null references public."user"(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists app_workspace_members_user on public.app_workspace_members(user_id);

create table if not exists public.apps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_by text not null references public."user"(id) on delete restrict,
  legacy_deployment_id text unique references public.deployments(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index if not exists apps_workspace on public.apps(workspace_id);

alter table public.deployments add column if not exists app_id uuid;
alter table public.deployments add column if not exists workspace_id uuid;
alter table public.deployment_runs add column if not exists app_id uuid;
alter table public.deployment_runs add column if not exists workspace_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.deployments'::regclass and conname = 'deployments_app_workspace_pair') then
    alter table public.deployments add constraint deployments_app_workspace_pair
      check ((app_id is null) = (workspace_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.deployments'::regclass and conname = 'deployments_app_workspace_fkey') then
    alter table public.deployments add constraint deployments_app_workspace_fkey
      foreign key (app_id, workspace_id) references public.apps(id, workspace_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.deployment_runs'::regclass and conname = 'deployment_runs_app_workspace_pair') then
    alter table public.deployment_runs add constraint deployment_runs_app_workspace_pair
      check ((app_id is null) = (workspace_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.deployment_runs'::regclass and conname = 'deployment_runs_app_workspace_fkey') then
    alter table public.deployment_runs add constraint deployment_runs_app_workspace_fkey
      foreign key (app_id, workspace_id) references public.apps(id, workspace_id) on delete restrict;
  end if;
end $$;

create index if not exists deployments_app on public.deployments(app_id) where app_id is not null;
create index if not exists deployment_runs_app on public.deployment_runs(app_id, started_at desc) where app_id is not null;

-- Better Auth identity is resolved by the server, not Supabase auth.uid().
-- No client policies/grants: authorization must precede privileged server queries.
alter table public.app_workspaces enable row level security;
alter table public.app_workspace_members enable row level security;
alter table public.apps enable row level security;
revoke all on public.app_workspaces, public.app_workspace_members, public.apps from public;
grant all on public.app_workspaces, public.app_workspace_members, public.apps to service_role;

commit;
