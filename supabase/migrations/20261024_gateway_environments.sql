-- Operator-owned classification; unclassified bindings must never expose previews to app-use members.
-- Apply after app_gateway_auth and gateway_platform_sessions with gateway feature flags disabled.
begin;
do $$
begin
  if not exists (
    select 1 from pg_attribute where attrelid = 'public.app_gateway_bindings'::regclass
    and attname = 'environment' and not attisdropped
  ) then
    alter table public.app_gateway_bindings add column environment text not null default 'preview'
      constraint app_gateway_environment check (environment in ('published', 'preview'));
    -- Earlier credentials were issued without an environment boundary. Force fresh app login once.
    delete from public.app_gateway_codes;
    delete from public.app_gateway_sessions;
  end if;
end $$;

create or replace trigger app_gateway_binding_change after update of origin, disabled_at, environment on public.app_gateway_bindings
  for each row when (OLD.origin is distinct from NEW.origin or OLD.disabled_at is distinct from NEW.disabled_at
    or OLD.environment is distinct from NEW.environment)
  execute function public.invalidate_app_gateway_access();
commit;
