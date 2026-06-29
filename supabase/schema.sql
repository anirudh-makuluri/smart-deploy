-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor) to create tables.
-- Prerequisite: Better Auth tables must exist first (`npm run auth:migrate` with DATABASE_URL)
-- so `public."user"` is present — this schema references it for foreign keys.

-- Identity lives in Better Auth's `public."user"` (created by `npm run auth:migrate`).
-- App tables reference that id via foreign keys (same string id the session uses).

create table public.deployments (
  id text primary key,
  repo_name text not null,
  repo_url text not null default '',
  service_name text not null,
  owner_id text not null references public."user"(id) on delete cascade,

  branch text not null default 'main',
  commit_sha text,
  hosted_subdomain text,
  screenshot_url text,

  cloud_provider text not null default 'aws',
  deployment_target text not null default 'ecs',
  region text not null default 'us-west-2',

  status text not null default 'didnt_deploy',
  first_deployment timestamptz,
  last_deployment timestamptz,
  revision int not null default 1,

  cloud_resources jsonb,
  secrets_arn text,

  response_id uuid
);

create unique index idx_deployments_hosted_subdomain
  on public.deployments(hosted_subdomain)
  where hosted_subdomain is not null;
create index idx_deployments_owner on public.deployments(owner_id);
create index idx_deployments_region on public.deployments(region);
create index idx_deployments_provider on public.deployments(cloud_provider);
create index idx_deployments_response_id on public.deployments(response_id);

-- Full analysis responses are stored separately and linked by deployments.response_id
create table if not exists public.analysis_responses (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null,
  repo_url text not null,
  commit_sha text,
  package_path text not null default '.',
  service_name text,
  from_cache boolean not null default false,
  passed boolean not null default false,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_analysis_responses_repo_url on public.analysis_responses(repo_url);
create index if not exists idx_analysis_responses_created_at on public.analysis_responses(created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'deployments_response_id_fkey'
  ) then
    alter table public.deployments
      add constraint deployments_response_id_fkey
      foreign key (response_id)
      references public.analysis_responses(id)
      on delete set null;
  end if;
end $$;

-- Deployment runs: per-attempt metadata; full pipeline logs in S3 (LOGS_BUCKET).
-- Intentionally no FK to deployments so runs survive deployment deletion.
create table if not exists public.deployment_runs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public."user"(id) on delete cascade,
  repo_name text not null,
  service_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  success boolean,
  duration_ms int,
  branch text,
  commit_sha text,
  commit_message text,
  failure_code text,
  failure_classification jsonb,
  release_artifact jsonb not null default '{}',
  response_id uuid references public.analysis_responses(id) on delete set null,
  log_store text not null default 's3',
  log_ref text,
  step_summary jsonb not null default '[]',
  log_tail jsonb not null default '[]'
);

create index if not exists idx_deployment_runs_user_repo_service
  on public.deployment_runs(user_id, repo_name, service_name);
create index if not exists idx_deployment_runs_user_started
  on public.deployment_runs(user_id, started_at desc);
create index if not exists idx_deployment_runs_latest_success
  on public.deployment_runs(user_id, repo_name, service_name, success, started_at desc);

-- Deployment agent messages: append-only log for eval / LLMOps (live sessions stay in-memory on the WS server).
create table if not exists public.deployment_agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public."user"(id) on delete cascade,
  conversation_id text not null,
  run_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_deployment_agent_messages_conversation
  on public.deployment_agent_messages(user_id, conversation_id, created_at asc);
create index if not exists idx_deployment_agent_messages_user_created
  on public.deployment_agent_messages(user_id, created_at desc);
create index if not exists idx_deployment_agent_messages_run
  on public.deployment_agent_messages(run_id);

-- Help-agent chats: one row per completed Q/A exchange.
create table if not exists public.help_agent_chats (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public."user"(id) on delete cascade,
  question text not null,
  answer text not null,
  citations jsonb not null default '[]',
  confidence text not null default 'low' check (confidence in ('high', 'medium', 'low')),
  model text,
  moss_retrieval_ms int,
  response_time_ms int,
  chat_history jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists idx_help_agent_chats_user_created
  on public.help_agent_chats(user_id, created_at desc);

-- Artifact generation events: append-only facts about generated infra files.
create table if not exists public.artifact_events (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public."user"(id) on delete cascade,
  repo_name text not null,
  service_name text not null,
  timestamp timestamptz not null default now(),
  source text not null, -- 'scan' | 'feedback' | 'manual'
  artifact_type text not null, -- 'dockerfile' | 'compose' | 'nginx'
  action text not null default 'generated', -- future-proof
  count int not null default 1
);

create index if not exists idx_artifact_events_user_time
  on public.artifact_events(user_id, timestamp desc);
create index if not exists idx_artifact_events_user_repo_service
  on public.artifact_events(user_id, repo_name, service_name);

-- User repos: one row per repo per user with denormalized fields
create table if not exists public.user_repos (
  user_id text not null references public."user"(id) on delete cascade,
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
  user_id text not null references public."user"(id) on delete cascade,
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

-- Product issue reports and general product feedback from signed-in users.
create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public."user"(id) on delete cascade,
  user_email text,
  user_name text,
  user_image text,
  category text not null default 'bug' check (category in ('bug', 'feature', 'general', 'other')),
  message text not null,
  page_path text,
  repo_owner text,
  repo_name text,
  service_name text,
  metadata jsonb not null default '{}',
  status text not null default 'new',
  created_at timestamptz not null default now()
);
create index if not exists idx_user_reports_user_time on public.user_reports(user_id, created_at desc);
create index if not exists idx_user_reports_category_time on public.user_reports(category, created_at desc);

-- Optional: minimal table for health checks (or use: select 1 from public._health limit 1)
create table if not exists public._health (
  id int primary key default 1,
  checked_at timestamptz default now()
);
insert into public._health (id) values (1) on conflict (id) do nothing;

-- RLS: disable or set policies as needed; service role bypasses RLS
alter table public.deployments enable row level security;
alter table public.analysis_responses enable row level security;
alter table public.deployment_runs enable row level security;
alter table public.deployment_agent_messages enable row level security;
alter table public.help_agent_chats enable row level security;
alter table public.user_repos enable row level security;
alter table public.artifact_events enable row level security;
alter table public.waiting_list enable row level security;
alter table public.approved_users enable row level security;
alter table public.user_reports enable row level security;

-- RLS Policies for user_repos
create policy "Users can view their own repos" on public.user_repos
  for select using (auth.uid()::text = user_id);

create policy "Users can manage their own repos" on public.user_repos
  for all using (auth.uid()::text = user_id);

-- RLS Policies for user_reports
create policy "Users can view their own reports" on public.user_reports
  for select using (auth.uid()::text = user_id);

create policy "Users can insert their own reports" on public.user_reports
  for insert with check (auth.uid()::text = user_id);

-- RLS Policies for deployment_agent_messages
create policy "Users can view their own deployment agent messages" on public.deployment_agent_messages
  for select using (auth.uid()::text = user_id);

create policy "Users can insert their own deployment agent messages" on public.deployment_agent_messages
  for insert with check (auth.uid()::text = user_id);

-- RLS Policies for help_agent_chats
create policy "Users can view their own help agent chats" on public.help_agent_chats
  for select using (auth.uid()::text = user_id);

create policy "Users can insert their own help agent chats" on public.help_agent_chats
  for insert with check (auth.uid()::text = user_id);

-- Allow service role full access (service role key bypasses RLS by default)
-- If using anon key from client, add policies here.

-- Aggregate deploy metrics (all-time; optional filter by user id). Used by server via service role only.
create or replace function public.get_deploy_metrics(p_user_id text default null)
returns jsonb
language sql
stable
as $$
  with filtered as (
    select success, duration_ms
    from public.deployment_runs
    where finished_at is not null
      and (p_user_id is null or user_id = p_user_id)
  ),
  counts as (
    select
      count(*)::bigint as total_count,
      count(*) filter (where success = true)::bigint as success_count
    from filtered
  ),
  dur as (
    select duration_ms
    from filtered
    where duration_ms is not null
  )
  select jsonb_build_object(
    'total_count', (select total_count from counts),
    'success_count', (select success_count from counts),
    'duration_sample_count', (select count(*)::bigint from dur),
    'median_duration_ms', (select percentile_cont(0.5) within group (order by duration_ms) from dur),
    'p95_duration_ms', (select percentile_cont(0.95) within group (order by duration_ms) from dur)
  );
$$;

revoke all on function public.get_deploy_metrics(text) from public;
grant execute on function public.get_deploy_metrics(text) to service_role;

-- Artifact generation metrics (all-time; optional filter by user id). Used by server via service role only.
create or replace function public.get_artifact_generation_metrics(p_user_id text default null)
returns jsonb
language sql
stable
as $$
  with events_filtered as (
    select artifact_type, sum(count)::bigint as generated_count
    from public.artifact_events
    where action = 'generated'
      and (p_user_id is null or user_id = p_user_id)
    group by artifact_type
  ),
  runs as (
    select success, release_artifact::jsonb as release_artifact
    from public.deployment_runs
    where finished_at is not null
      and (p_user_id is null or user_id = p_user_id)
  ),
  success_total as (
    select count(*)::bigint as n
    from runs
    where success = true
  ),
  success_flags as (
    select
      count(*) filter (
        where success = true
          and coalesce((release_artifact #>> '{deployConfig,scanResults,has_existing_dockerfiles}')::boolean, false) = false
          and coalesce(jsonb_typeof(release_artifact #> '{deployConfig,scanResults,dockerfiles}'), '') = 'object'
          and exists (
            select 1
            from jsonb_each(coalesce(release_artifact #> '{deployConfig,scanResults,dockerfiles}', '{}'::jsonb))
          )
      )::bigint as success_with_generated_dockerfiles,

      count(*) filter (
        where success = true
          and coalesce((release_artifact #>> '{deployConfig,scanResults,has_existing_compose}')::boolean, false) = false
          and length(coalesce(release_artifact #>> '{deployConfig,scanResults,docker_compose}', '')) > 0
      )::bigint as success_with_generated_compose,

      count(*) filter (
        where success = true
          and length(coalesce(release_artifact #>> '{deployConfig,scanResults,nginx_conf}', '')) > 0
      )::bigint as success_with_nginx_conf
    from runs
  )
  select jsonb_build_object(
    'generated_counts', jsonb_build_object(
      'dockerfile', coalesce((select generated_count from events_filtered where artifact_type = 'dockerfile'), 0),
      'compose', coalesce((select generated_count from events_filtered where artifact_type = 'compose'), 0),
      'nginx', coalesce((select generated_count from events_filtered where artifact_type = 'nginx'), 0)
    ),
    'successful_deploys_total', (select n from success_total),
    'success_with_generated_dockerfiles', (select success_with_generated_dockerfiles from success_flags),
    'success_with_generated_compose', (select success_with_generated_compose from success_flags),
    'success_with_nginx_conf', (select success_with_nginx_conf from success_flags)
  );
$$;

revoke all on function public.get_artifact_generation_metrics(text) from public;
grant execute on function public.get_artifact_generation_metrics(text) to service_role;
