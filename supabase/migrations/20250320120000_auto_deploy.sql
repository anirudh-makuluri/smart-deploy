-- Auto-deploy via GitHub App: query deployments by installation + full repo name.
alter table public.deployments
  add column if not exists github_full_name text,
  add column if not exists github_installation_id bigint,
  add column if not exists auto_deploy_enabled boolean not null default false,
  add column if not exists auto_deploy_branch text,
  add column if not exists last_auto_deploy_sha text;

create index if not exists idx_deployments_auto_deploy_lookup
  on public.deployments (github_installation_id, github_full_name)
  where auto_deploy_enabled = true;
