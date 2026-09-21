-- ============================================================================
-- 0019 — Credit control
--
-- Three things the schema described but nothing enforced:
--
--   1. A credit limit was a number on the customer row that no code read. A
--      sale past the limit went through silently, whether it came from the
--      shift-close wizard or from a direct insert.
--   2. The 21 seeded placeholder parties are inactive, and the seed comment
--      claimed an inactive party "cannot be picked in the credit-sale form".
--      That was a statement about a form, not a rule about the data. A sale
--      could be booked against "Credit Party 07" and nobody would ever collect
--      it, because no such party exists.
--   3. Ageing had nowhere to come from. The opening balance a party carries in
--      at go-live is the oldest thing it owes, and the ledger held no row for
--      it at all.
--
-- The block lives in a trigger rather than in a server action, because the
-- wizard, the dues screen and any future n8n route all insert into the same
-- table and each of them would otherwise need to remember.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- How old is the balance a party walks in with?
--
-- At go-live each of the real parties carries a balance from the paper ledger.
-- Some of it is last week's diesel and some of it has been owed for a year,
-- and the difference is the whole point of an ageing report. The chairman
-- knows roughly; this is where he records it. Left empty, the opening balance
-- is dated from the day the party was set up, which is the most cautious guess
-- available and is labelled as a guess on the screen.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists opening_balance_as_of date;

comment on column public.customers.opening_balance_as_of is
  'The date the opening balance is aged from. Null means it has not been told '
  'to us, and ageing falls back to the date the party was created.';

-- ---------------------------------------------------------------------------
-- The opening balance is a starting point, not a running figure
--
-- customer_balance() reads the last ledger row's running_balance, and that row
-- was computed from whatever the opening balance was at the time. Editing the
-- opening balance afterwards would leave every running balance below it
-- pointing at a number that no longer exists — the ledger would say one thing
-- and the customer row another, with nothing to show which was right.
--
-- So it can be set and corrected freely until the party's first transaction,
-- and after that a correction is an adjustment row like any other.
-- ---------------------------------------------------------------------------
create or replace function public.guard_opening_balance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_entries integer;
begin
  if new.opening_balance is not distinct from old.opening_balance then
    return new;
  end if;

  select count(*) into v_entries
  from public.customer_ledger l
  where l.customer_id = new.id;

  if v_entries > 0 then
    raise exception '%', format(
      '%s already has %s ledger entries, so the opening balance is fixed. '
      'Post an adjustment instead — it keeps both figures and shows the '
      'correction.', old.name, v_entries)
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_opening_balance on public.customers;
create trigger trg_guard_opening_balance
  before update of opening_balance on public.customers
  for each row execute function public.guard_opening_balance();

-- ---------------------------------------------------------------------------
-- An over-limit sale is not forbidden. It is escalated.
--
-- A tanker is at the pump and the party is ৳2,000 over its limit; refusing
-- outright would just mean the sale is written on paper and never reaches the
-- system, which is worse than recording it. So a manager is blocked, and an
-- admin may record it with a written reason that is kept with the sale.
-- ---------------------------------------------------------------------------
alter table public.credit_sales
  add column if not exists over_limit_approved_by uuid references public.profiles(id),
  add column if not exists over_limit_reason text,
  add column if not exists balance_before numeric(14,2),
  add column if not exists balance_after numeric(14,2);

comment on column public.credit_sales.balance_before is
  'What the party owed the moment before this sale, stamped at insert. The '
  'ledger can be replayed, but a sale should carry the figure it was judged '
  'against.';

create or replace function public.enforce_credit_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_customer  public.customers;
  v_balance   numeric;
  v_projected numeric;
  v_message   text;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  -- The same lock the ledger takes, so two sales to one party cannot both read
  -- the same balance and both decide they fit under the limit.
  perform pg_advisory_xact_lock(hashtext(new.customer_id::text));

  select * into v_customer from public.customers where id = new.customer_id;

  if v_customer.id is null then
    raise exception 'No credit party with id %', new.customer_id
      using errcode = 'no_data_found';
  end if;

  if v_customer.deleted_at is not null or not v_customer.is_active then
    raise exception '%', format(
      '%s is not an active credit party, so nothing can be booked against it. '
      'If this is a real party, open it on the Dues screen first.',
      v_customer.name)
      using errcode = 'check_violation';
  end if;

  v_balance   := public.customer_balance(new.customer_id);
  v_projected := round(v_balance + new.amount, 2);

  new.balance_before := round(v_balance, 2);
  new.balance_after  := v_projected;

  -- A limit of zero means no limit has been agreed for this party, not a limit
  -- of nothing. The column comment in 0002 says so and this is where it binds.
  if v_customer.credit_limit > 0 and v_projected > v_customer.credit_limit then

    v_message := format(
      '%s already owes %s. This sale of %s would take the party to %s, past its limit of %s.',
      v_customer.name,
      to_char(v_balance, 'FM999,999,999.00'),
      to_char(new.amount, 'FM999,999,999.00'),
      to_char(v_projected, 'FM999,999,999.00'),
      to_char(v_customer.credit_limit, 'FM999,999,999.00'));

    if new.over_limit_approved_by is null then
      raise exception '%', v_message || ' Only the owner can let it through.'
        using errcode = 'check_violation';
    end if;

    -- The approval has to be the person sitting at the keyboard. Otherwise a
    -- manager could type the owner's id into the column and approve their own
    -- sale.
    if new.over_limit_approved_by is distinct from auth.uid() then
      raise exception '%',
        'An over-limit sale is approved by the person recording it, not on '
        'someone else''s behalf.'
        using errcode = 'check_violation';
    end if;

    if not public.is_admin() then
      raise exception '%', v_message || ' Only the owner can let it through.'
        using errcode = 'insufficient_privilege';
    end if;

    if nullif(btrim(coalesce(new.over_limit_reason, '')), '') is null then
      raise exception '%',
        'Write why this party is being allowed past its credit limit.'
        using errcode = 'check_violation';
    end if;
  else
    -- Nothing to approve, so nothing may be claimed.
    new.over_limit_approved_by := null;
    new.over_limit_reason := null;
  end if;

  return new;
end;
$$;

comment on function public.enforce_credit_limit() is
  'Refuses a credit sale against an inactive party, and refuses one that takes '
  'a party past its credit limit unless an admin records a written reason.';

drop trigger if exists trg_credit_limit on public.credit_sales;
create trigger trg_credit_limit
  before insert on public.credit_sales
  for each row execute function public.enforce_credit_limit();

-- An approved over-limit sale is exactly the sort of thing the chairman should
-- find waiting for him rather than discover at month end.
create or replace function public.alert_over_limit_sale()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_customer public.customers;
begin
  if new.over_limit_approved_by is null then
    return new;
  end if;

  select * into v_customer from public.customers where id = new.customer_id;

  insert into public.alerts (station_id, type, severity, title, title_bn, body, entity_ref, created_by)
  values (
    v_customer.station_id,
    'credit.over_limit',
    'warn',
    format('%s taken past its credit limit', v_customer.name),
    format('%s-এর ঋণসীমা অতিক্রম', coalesce(v_customer.name_bn, v_customer.name)),
    new.over_limit_reason,
    jsonb_build_object(
      'credit_sale_id', new.id,
      'customer_id', new.customer_id,
      'amount', new.amount,
      'balance_after', new.balance_after,
      'credit_limit', v_customer.credit_limit),
    new.created_by);

  return new;
end;
$$;

drop trigger if exists trg_over_limit_alert on public.credit_sales;
create trigger trg_over_limit_alert
  after insert on public.credit_sales
  for each row execute function public.alert_over_limit_sale();

-- ---------------------------------------------------------------------------
-- Ageing
--
-- Payments are applied oldest invoice first, which is how the parties and the
-- station both think about it: money that comes in clears the oldest bill.
-- The running total trick does the allocation without a loop — an item is
-- still outstanding for whatever part of it sits above the total paid.
--
-- The bucket totals deliberately do not have to add up to the balance. A party
-- that has paid in advance shows a negative balance and empty buckets, because
-- nothing is overdue; a party that owes shows buckets that sum to the balance.
-- ---------------------------------------------------------------------------
create or replace function public.customer_ageing(
  p_as_of date default (now() at time zone 'Asia/Dhaka')::date)
returns table (
  customer_id      uuid,
  customer_name    text,
  customer_name_bn text,
  credit_limit     numeric,
  balance          numeric,
  bucket_0_30      numeric,
  bucket_31_60     numeric,
  bucket_61_90     numeric,
  bucket_90_plus   numeric,
  oldest_item_days integer,
  opening_dated    boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  with items as (
    select
      c.id as cid,
      coalesce(c.opening_balance_as_of, (c.created_at at time zone 'Asia/Dhaka')::date) as item_date,
      c.opening_balance as amount,
      0 as seq,
      c.created_at as at,
      c.id as tie
    from public.customers c
    where c.deleted_at is null and c.opening_balance > 0

    union all

    select l.customer_id, l.entry_date, l.debit, 1, l.entry_at, l.id
    from public.customer_ledger l
    where l.debit > 0
  ),
  ordered as (
    select
      cid, item_date, amount,
      sum(amount) over (
        partition by cid
        order by item_date, seq, at, tie
        rows between unbounded preceding and current row) as cumulative
    from items
  ),
  settled as (
    select l.customer_id as cid, sum(l.credit) as credits
    from public.customer_ledger l
    group by l.customer_id
  ),
  open_items as (
    select
      o.cid,
      o.item_date,
      greatest(0, least(o.amount, o.cumulative - coalesce(s.credits, 0))) as outstanding
    from ordered o
    left join settled s on s.cid = o.cid
  )
  select
    c.id,
    c.name,
    c.name_bn,
    c.credit_limit,
    public.customer_balance(c.id),
    round(coalesce(sum(oi.outstanding) filter (where p_as_of - oi.item_date <= 30), 0), 2),
    round(coalesce(sum(oi.outstanding) filter (where p_as_of - oi.item_date between 31 and 60), 0), 2),
    round(coalesce(sum(oi.outstanding) filter (where p_as_of - oi.item_date between 61 and 90), 0), 2),
    round(coalesce(sum(oi.outstanding) filter (where p_as_of - oi.item_date > 90), 0), 2),
    max(p_as_of - oi.item_date)::integer,
    (c.opening_balance = 0 or c.opening_balance_as_of is not null)
  from public.customers c
  left join open_items oi on oi.cid = c.id and oi.outstanding > 0
  where c.deleted_at is null
  group by c.id, c.name, c.name_bn, c.credit_limit, c.opening_balance, c.opening_balance_as_of
  order by public.customer_balance(c.id) desc, c.name
$$;

comment on function public.customer_ageing(date) is
  'Party-wise ageing, payments applied oldest bill first. The opening balance '
  'is aged from customers.opening_balance_as_of, falling back to the date the '
  'party was created.';

revoke execute on function public.customer_ageing(date) from anon, public;
grant execute on function public.customer_ageing(date) to authenticated;

-- ---------------------------------------------------------------------------
-- What a sale would do, before it is made
--
-- The dues screen needs this to grey out the button and say why, using the
-- same balance the trigger will use a second later.
-- ---------------------------------------------------------------------------
create or replace function public.check_credit_headroom(
  p_customer_id uuid,
  p_amount numeric default 0)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_customer  public.customers;
  v_balance   numeric;
  v_projected numeric;
begin
  select * into v_customer from public.customers where id = p_customer_id;
  if v_customer.id is null then
    raise exception 'No credit party with id %', p_customer_id
      using errcode = 'no_data_found';
  end if;

  v_balance   := public.customer_balance(p_customer_id);
  v_projected := round(v_balance + coalesce(p_amount, 0), 2);

  return jsonb_build_object(
    'customer_id', v_customer.id,
    'name', v_customer.name,
    'is_active', v_customer.is_active and v_customer.deleted_at is null,
    'credit_limit', v_customer.credit_limit,
    'limit_set', v_customer.credit_limit > 0,
    'balance', round(v_balance, 2),
    'projected_balance', v_projected,
    'available', case when v_customer.credit_limit > 0
                      then round(v_customer.credit_limit - v_projected, 2) end,
    'utilisation_pct', case when v_customer.credit_limit > 0
                            then round(v_projected / v_customer.credit_limit * 100, 2) end,
    'exceeded', v_customer.credit_limit > 0 and v_projected > v_customer.credit_limit,
    'needs_owner_approval',
      v_customer.credit_limit > 0
      and v_projected > v_customer.credit_limit
      and not public.is_admin());
end;
$$;

revoke execute on function public.check_credit_headroom(uuid, numeric) from anon, public;
grant execute on function public.check_credit_headroom(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Correcting a balance
--
-- The only way to change what a party owes without a sale or a payment behind
-- it. Owner only, reason compulsory, and it lands as a visible ledger line
-- rather than quietly moving an older number. A positive amount raises what
-- the party owes; a negative one writes it down.
-- ---------------------------------------------------------------------------
create or replace function public.post_customer_adjustment(
  p_customer_id uuid,
  p_amount numeric,
  p_reason text)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
  v_after  numeric;
begin
  if not public.is_admin() then
    raise exception 'Only the owner may adjust a party''s balance'
      using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null then
    raise exception 'Write why this balance is being adjusted'
      using errcode = 'check_violation';
  end if;
  if coalesce(p_amount, 0) = 0 then
    raise exception 'An adjustment of zero changes nothing'
      using errcode = 'check_violation';
  end if;

  insert into public.customer_ledger
    (customer_id, entry_type, description, debit, credit, source_table, created_by)
  values
    (p_customer_id, 'adjustment', v_reason,
     case when p_amount > 0 then round(p_amount, 2) else 0 end,
     case when p_amount < 0 then round(-p_amount, 2) else 0 end,
     'manual_adjustment', auth.uid())
  returning id, running_balance into v_id, v_after;

  return jsonb_build_object('entry_id', v_id, 'balance', v_after);
end;
$$;

revoke execute on function public.post_customer_adjustment(uuid, numeric, text) from anon, public;
grant execute on function public.post_customer_adjustment(uuid, numeric, text) to authenticated;
