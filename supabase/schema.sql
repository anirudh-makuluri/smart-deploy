-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor) to create tables.
-- Replace existing Firebase/Firestore usage with these tables.

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
  
  -- Core deployment fields
  url text not null default '',
  branch text not null default '',
  commit_sha text,
  env_vars text,
  live_url text,
  screenshot_url text,
  cloud_provider text default 'aws',
  deployment_target text default 'ec2',
  aws_region text not null default 'us-west-2',
  
  -- Status and metadata
  status text default 'didnt_deploy',
  first_deployment timestamptz,
  last_deployment timestamptz,
  revision int default 1,
  
  -- Complex nested objects stay in JSONB
  ec2 jsonb,
  cloud_run jsonb,
  scan_results jsonb
);

create index if not exists idx_deployments_owner on public.deployments(owner_id);
create index if not exists idx_deployments_region on public.deployments(aws_region);
create index if not exists idx_deployments_provider on public.deployments(cloud_provider);

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

-- User repos: one row per repo per user with denormalized fields
create table if not exists public.user_repos (
  user_id text not null references public.users(id) on delete cascade,
  repo_name text not null,
  
  -- Repository metadata (denormalized for efficient querying)
  id text not null,
  full_name text not null,
  repo_owner text not null,
  html_url text not null,
  language text,
  languages_url text not null,
  created_at text not null,
  updated_at text not null,
  pushed_at text not null,
  default_branch text not null,
  private boolean not null,
  visibility text not null,
  owner_login text not null,
  
  -- Complex nested data stored as JSONB
  latest_commit jsonb,
  branches jsonb not null default '[]',
  
  -- Sync metadata
  synced_at timestamptz not null default now(),
  sync_error text,
  
  primary key (user_id, repo_name)
);

-- Indexes for efficient user repo queries
create index if not exists idx_user_repos_user_id on public.user_repos(user_id);
create index if not exists idx_user_repos_language on public.user_repos(user_id, language);
create index if not exists idx_user_repos_visibility on public.user_repos(user_id, visibility);
create index if not exists idx_user_repos_synced_at on public.user_repos(user_id, synced_at desc);

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

-- Approved users: emails that are allowed to sign in
create table if not exists public.approved_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  created_at timestamptz default now(),
  unique(email)
);
create index if not exists idx_approved_users_email on public.approved_users(email);

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
alter table public.approved_users enable row level security;

-- RLS Policies for user_repos
create policy "Users can view their own repos" on public.user_repos
  for select using (auth.uid()::text = user_id);

create policy "Users can manage their own repos" on public.user_repos
  for all using (auth.uid()::text = user_id);

-- Allow service role full access (service role key bypasses RLS by default)
-- If using anon key from client, add policies here.
