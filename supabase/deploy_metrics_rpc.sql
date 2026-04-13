-- Run once in Supabase SQL Editor if you already applied schema.sql before this function existed.
-- Also appended to supabase/schema.sql for new installs.

create or replace function public.get_deploy_metrics(p_user_id text default null)
returns jsonb
language sql
stable
as $$
  with filtered as (
    select success, duration_ms
    from public.deployment_history
    where p_user_id is null or user_id = p_user_id
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
