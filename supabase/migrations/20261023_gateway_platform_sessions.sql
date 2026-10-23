-- Requires the existing Better Auth public.session table (default field names).
-- Unbound credentials cannot be safely backfilled: force fresh app login once.
begin;
alter table public.app_gateway_codes add column if not exists platform_session_id text references public.session(id) on delete cascade;
alter table public.app_gateway_sessions add column if not exists platform_session_id text references public.session(id) on delete cascade;
delete from public.app_gateway_codes where platform_session_id is null;
delete from public.app_gateway_sessions where platform_session_id is null;
alter table public.app_gateway_codes alter column platform_session_id set not null;
alter table public.app_gateway_sessions alter column platform_session_id set not null;
create index if not exists app_gateway_codes_platform_session on public.app_gateway_codes(platform_session_id);
create index if not exists app_gateway_sessions_platform_session on public.app_gateway_sessions(platform_session_id);

create or replace function public.invalidate_gateway_on_platform_logout() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  -- Serialize global invalidation with issuance/redemption's shared user lock.
  perform id from public."user" where id = OLD."userId" for update;
  delete from public.app_gateway_codes where user_id = OLD."userId";
  delete from public.app_gateway_sessions where user_id = OLD."userId";
  return null;
end $$;
create or replace trigger app_gateway_platform_logout after delete on public.session
  for each row when (OLD."expiresAt" > clock_timestamp()) execute function public.invalidate_gateway_on_platform_logout();
create or replace trigger app_gateway_platform_session_change after update of "userId", "expiresAt" on public.session
  for each row when (OLD."userId" is distinct from NEW."userId" or NEW."expiresAt" < OLD."expiresAt")
  execute function public.invalidate_gateway_on_platform_logout();
revoke all on function public.invalidate_gateway_on_platform_logout() from public;
commit;
