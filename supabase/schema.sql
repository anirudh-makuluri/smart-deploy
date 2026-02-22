-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor) to create tables.
-- Replace existing Firebase/Firestore usage with these tables.

-- Users: id = auth provider user id (e.g. GitHub), profile fields, list of deployment ids
create table if not exists public.users (
  id text primary key,
  name text,
  image text,
  created_at timestamptz default now(),
  deployment_ids text[] default '{}'
);

-- Deployments: one row per deployment; id = deployment id (e.g. repo/branch slug)
create table if not exists public.deployments (
  id text primary key,
  owner_id text not null references public.users(id) on delete cascade,
  status text default 'running',
  first_deployment timestamptz,
  last_deployment timestamptz,
  revision int default 1,
  data jsonb not null default '{}'
);

create index if not exists idx_deployments_owner on public.deployments(owner_id);

-- Deployment history: stored per user so it survives deployment deletion
create table if not exists public.deployment_history (
  id uuid primary key default gen_random_uuid(),
  deployment_id text not null,
  user_id text not null references public.users(id) on delete cascade,
  timestamp timestamptz not null default now(),
  success boolean not null,
  steps jsonb not null default '[]',
  config_snapshot jsonb not null default '{}',
  commit_sha text,
  commit_message text,
  branch text,
  duration_ms int,
  service_name text,
  repo_url text
);

create index if not exists idx_deployment_history_user_deployment
  on public.deployment_history(user_id, deployment_id);
create index if not exists idx_deployment_history_user_time
  on public.deployment_history(user_id, timestamp desc);

-- User repos: one row per repo per user (keyed by repo name)
create table if not exists public.user_repos (
  user_id text not null references public.users(id) on delete cascade,
  repo_name text not null,
  data jsonb not null default '{}',
  primary key (user_id, repo_name)
);

-- Waiting list: emails (and optional name) of users who attempted sign-in but were not granted access
create table if not exists public.waiting_list (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  created_at timestamptz default now(),
  unique(email)
);
create index if not exists idx_waiting_list_email on public.waiting_list(email);

-- Optional: minimal table for health checks (or use: select 1 from users limit 1)
create table if not exists public._health (
  id int primary key default 1,
  checked_at timestamptz default now()
);
insert into public._health (id) values (1) on conflict (id) do nothing;

-- RLS: disable or set policies as needed; service role bypasses RLS
alter table public.users enable row level security;
alter table public.deployments enable row level security;
alter table public.deployment_history enable row level security;
alter table public.user_repos enable row level security;
alter table public.waiting_list enable row level security;

-- Allow service role full access (service role key bypasses RLS by default)
-- If using anon key from client, add policies here.
