-- Run once in Supabase SQL Editor if you already applied schema.sql before this function existed.

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
  history as (
    select
      success,
      config_snapshot::jsonb as config_snapshot
    from public.deployment_history
    where (p_user_id is null or user_id = p_user_id)
  ),
  success_total as (
    select count(*)::bigint as n
    from history
    where success = true
  ),
  success_flags as (
    select
      -- dockerfiles_generated: we treat "generated" when scanResults says there were no existing dockerfiles.
      count(*) filter (
        where success = true
          and coalesce((config_snapshot #>> '{scanResults,has_existing_dockerfiles}')::boolean, false) = false
          and coalesce(jsonb_typeof(config_snapshot #> '{scanResults,dockerfiles}'), '') = 'object'
          and exists (
            select 1
            from jsonb_each(coalesce(config_snapshot #> '{scanResults,dockerfiles}', '{}'::jsonb))
          )
      )::bigint as success_with_generated_dockerfiles,

      count(*) filter (
        where success = true
          and coalesce((config_snapshot #>> '{scanResults,has_existing_compose}')::boolean, false) = false
          and length(coalesce(config_snapshot #>> '{scanResults,docker_compose}', '')) > 0
      )::bigint as success_with_generated_compose,

      -- nginx: SDArtifacts doesn't currently expose "has_existing_nginx". Track presence as a capability metric.
      count(*) filter (
        where success = true
          and length(coalesce(config_snapshot #>> '{scanResults,nginx_conf}', '')) > 0
      )::bigint as success_with_nginx_conf
    from history
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

