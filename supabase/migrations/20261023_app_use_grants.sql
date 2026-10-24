-- Requires app/workspace foundation. Grant metadata does not protect runtime traffic.
begin;
create table if not exists public.app_use_grants (
  app_id uuid not null,
  workspace_id uuid not null,
  user_id text not null,
  granted_by text not null references public."user"(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (app_id, user_id),
  foreign key (app_id, workspace_id) references public.apps(id, workspace_id) on delete cascade,
  foreign key (workspace_id, user_id) references public.app_workspace_members(workspace_id, user_id) on delete cascade
);
create index if not exists app_use_grants_membership on public.app_use_grants(workspace_id, user_id);

create table if not exists public.app_access_events (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null,
  workspace_id uuid not null,
  actor_id text not null references public."user"(id) on delete restrict,
  subject_id text not null references public."user"(id) on delete restrict,
  action text not null check (action in ('grant', 'revoke')),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (app_id, workspace_id) references public.apps(id, workspace_id) on delete restrict
);
create index if not exists app_access_events_app on public.app_access_events(app_id, created_at desc);
alter table public.app_use_grants enable row level security;
alter table public.app_access_events enable row level security;
revoke all on public.app_use_grants, public.app_access_events from public;
grant all on public.app_use_grants to service_role;
revoke all on public.app_access_events from service_role;
grant select, insert on public.app_access_events to service_role;
commit;
