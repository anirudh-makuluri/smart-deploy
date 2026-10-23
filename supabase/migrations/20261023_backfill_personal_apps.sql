-- Optional operator step after 20261023_app_workspaces.sql. Never run at startup.
begin;
select pg_advisory_xact_lock(hashtext('smartdeploy-personal-app-backfill'));

insert into public.app_workspaces (name, kind, owner_id)
select 'Personal workspace', 'personal', owner_id
from public.deployments
where app_id is null
group by owner_id
on conflict (owner_id) where kind = 'personal' do nothing;

insert into public.apps (workspace_id, name, created_by, legacy_deployment_id)
select w.id,
       left(coalesce(nullif(btrim(d.service_name), ''), nullif(btrim(d.repo_name), ''), 'App'), 120),
       d.owner_id, d.id
from public.deployments d
join public.app_workspaces w on w.owner_id = d.owner_id and w.kind = 'personal'
where d.app_id is null
on conflict (legacy_deployment_id) do nothing;

update public.deployments d
set app_id = a.id, workspace_id = a.workspace_id
from public.apps a
join public.app_workspaces w on w.id = a.workspace_id and w.kind = 'personal'
where a.legacy_deployment_id = d.id and w.owner_id = d.owner_id
  and a.created_by = d.owner_id and d.app_id is null;

-- Historical repo/service names can be ambiguous. Associate only an exact,
-- unique owner/repo/service match and leave already associated runs untouched.
with unambiguous as (
  select owner_id, repo_name, service_name
  from public.deployments
  group by owner_id, repo_name, service_name
  having count(*) = 1
)
update public.deployment_runs r
set app_id = d.app_id, workspace_id = d.workspace_id
from public.deployments d
join unambiguous u using (owner_id, repo_name, service_name)
where r.user_id = d.owner_id and r.repo_name = d.repo_name and r.service_name = d.service_name
  and d.app_id is not null and r.app_id is null;

commit;
