-- ============================================================================
-- 0011 — Move pg_trgm out of `public`
--
-- An extension in `public` puts its functions and operators in the schema
-- PostgREST exposes, and lets them collide with application objects. The
-- customer-name search index is rebuilt against the relocated operator class.
-- ============================================================================

create schema if not exists extensions;
grant usage on schema extensions to authenticated, service_role;

drop index if exists public.idx_customers_name_trgm;
alter extension pg_trgm set schema extensions;

create index idx_customers_name_trgm
  on public.customers using gin (name extensions.gin_trgm_ops);

do $$
declare v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  if v_schema <> 'extensions' then
    raise exception 'pg_trgm is still in schema %', v_schema;
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'idx_customers_name_trgm'
  ) then
    raise exception 'the customer name search index was not rebuilt';
  end if;
end $$;
