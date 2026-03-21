-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor) to create tables.
-- Replace existing Firebase/Firestore usage with these tables.
-- Note: This schema already includes GitHub App auto-deploy columns/indexes for fresh installs.
-- Existing databases should still run migrations in supabase/migrations.

-- Users: id = auth provider user id (e.g. GitHub), profile fields
create table if not exists public.users (
  id text primary key,
  name text,
  image text,
  created_at timestamptz default now(),
);

-- Deployments: one row per deployment; id = deployment id (e.g. repo/branch slug)
create table if not exists public.deployments (
  id text primary key,
  repo_name text not null,
  service_name text not null,
  owner_id text not null references public.users(id) on delete cascade,
  status text default 'running',
  first_deployment timestamptz,
  last_deployment timestamptz,
  revision int default 1,
  github_full_name text,
  github_installation_id bigint,
  auto_deploy_enabled boolean not null default false,
  auto_deploy_branch text,
  last_auto_deploy_sha text,
  data jsonb not null default '{}',
  scan_results jsonb
);

create index if not exists idx_deployments_owner on public.deployments(owner_id);
create index if not exists idx_deployments_auto_deploy_lookup
  on public.deployments (github_installation_id, github_full_name)
  where auto_deploy_enabled = true;

-- Deployment history: stored per user so it survives deployment deletion
create table if not exists public.deployment_history (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users(id) on delete cascade,
  repo_name text not null,
  service_name text not null,
  timestamp timestamptz not null default now(),
  success boolean not null,
  steps jsonb not null default '[]',
  config_snapshot jsonb not null default '{}',
  commit_sha text,
  commit_message text,
  branch text,
  duration_ms int
);

create index if not exists idx_deployment_history_user_repo_service
  on public.deployment_history(user_id, repo_name, service_name);
create index if not exists idx_deployment_history_user_time
  on public.deployment_history(user_id, timestamp desc);

-- User repos: one row per repo per user (keyed by repo name)
create table if not exists public.user_repos (
  user_id text not null references public.users(id) on delete cascade,
  repo_name text not null,
  data jsonb not null default '{}',
  primary key (user_id, repo_name)
);

-- Detected services per repo (from detect-services); one row per repo per user
create table if not exists public.repo_services (
  user_id text not null references public.users(id) on delete cascade,
  repo_url text not null,
  branch text not null default 'main',
  repo_owner text not null,
  repo_name text not null,
  services jsonb not null default '[]',
  is_monorepo boolean default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, repo_url)
);
create index if not exists idx_repo_services_user on public.repo_services(user_id);
alter table public.repo_services enable row level security;

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
