-- ============================================================================
-- 0021 — The ledger needs an order, and a timestamp is not one
--
-- Found while proving Phase 6's acceptance criteria. Five credit sales of
-- ৳1,000 to one party, posted in a single transaction, left the party owing
-- ৳2,000:
--
--     debit 1000.00  running_balance 3000.00
--     debit 1000.00  running_balance 3000.00
--     debit 1000.00  running_balance 2000.00
--     debit 1000.00  running_balance 1000.00
--     debit 1000.00  running_balance 2000.00
--     customer_balance() → 2000.00
--
-- ৳3,000 gone, silently, with every document still on file.
--
-- The cause: set_ledger_running_balance() found the previous entry with
--
--     order by l.entry_at desc, l.id desc limit 1
--
-- and inside one transaction now() does not advance, so every row carried the
-- same entry_at and the tie fell to l.id — a random uuid. Each insert read
-- whichever earlier row happened to sort highest rather than the one actually
-- before it, so balances repeated, skipped, and ended wherever the last draw
-- landed. customer_balance() read the final figure the same way and agreed
-- with nothing.
--
-- This is not a rare case. close_shift() stamps every credit sale in a close
-- with sold_at = the shift's end time, so a shift with more than one credit
-- sale to the same party hit it every time.
--
-- The fix is to stop asking a clock to do a sequence's job. entry_seq is
-- assigned by the database in insertion order, and the advisory lock already
-- held per customer means that order is the order the money moved.
-- ============================================================================

alter table public.customer_ledger
  add column if not exists entry_seq bigserial;

comment on column public.customer_ledger.entry_seq is
  'Insertion order. The ledger chains on this, never on entry_at: several '
  'entries can share a timestamp, and two that do must still have an order.';

create unique index if not exists customer_ledger_customer_seq_idx
  on public.customer_ledger (customer_id, entry_seq);

-- ---------------------------------------------------------------------------
-- The running balance, chained on the sequence
-- ---------------------------------------------------------------------------
create or replace function public.set_ledger_running_balance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_previous numeric;
begin
  -- Serialise ledger writes for this customer so two concurrent sales cannot
  -- both read the same previous balance.
  perform pg_advisory_xact_lock(hashtext(new.customer_id::text));

  -- entry_seq carries its default by the time a BEFORE trigger runs, so the
  -- row already knows where it sits in the queue.
  select l.running_balance into v_previous
  from public.customer_ledger l
  where l.customer_id = new.customer_id
    and l.entry_seq < new.entry_seq
  order by l.entry_seq desc
  limit 1;

  if v_previous is null then
    select c.opening_balance into v_previous from public.customers c where c.id = new.customer_id;
    v_previous := coalesce(v_previous, 0);
  end if;

  new.running_balance := round(v_previous + coalesce(new.debit, 0) - coalesce(new.credit, 0), 2);
  return new;
end;
$$;

drop trigger if exists trg_ledger_running_balance on public.customer_ledger;
create trigger trg_ledger_running_balance
  before insert on public.customer_ledger
  for each row execute function public.set_ledger_running_balance();

create or replace function public.customer_balance(p_customer_id uuid)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select l.running_balance from public.customer_ledger l
      where l.customer_id = p_customer_id
      order by l.entry_seq desc limit 1),
    (select c.opening_balance from public.customers c where c.id = p_customer_id),
    0)
$$;

comment on function public.customer_balance(uuid) is
  'What a party owes: the running balance on its last ledger entry by '
  'insertion order, or its opening balance if it has never transacted.';

-- ---------------------------------------------------------------------------
-- Ageing, ordered the same way
--
-- Two bills dated the same day are cleared in the order they were raised.
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
      -1::bigint as ord
    from public.customers c
    where c.deleted_at is null and c.opening_balance > 0

    union all

    select l.customer_id, l.entry_date, l.debit, l.entry_seq
    from public.customer_ledger l
    where l.debit > 0
  ),
  ordered as (
    select
      cid, item_date, amount,
      sum(amount) over (
        partition by cid
        order by item_date, ord
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
  'Party-wise ageing, payments applied oldest bill first and same-day bills in '
  'the order they were raised. The opening balance is aged from '
  'customers.opening_balance_as_of, falling back to the date the party was '
  'created.';

revoke execute on function public.customer_ageing(date) from anon, public;
grant execute on function public.customer_ageing(date) to authenticated;

-- ---------------------------------------------------------------------------
-- A three-valued role check is not a permission check
--
-- is_admin() returns null rather than false when there is no signed-in
-- profile, and `if not null` is not taken. The path was unreachable — an
-- unauthenticated caller is stopped by RLS long before — but a permission
-- check that fails open if it is ever reached the wrong way is not worth
-- leaving in place.
-- ---------------------------------------------------------------------------
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

    if new.over_limit_approved_by is distinct from auth.uid() then
      raise exception '%',
        'An over-limit sale is approved by the person recording it, not on '
        'someone else''s behalf.'
        using errcode = 'check_violation';
    end if;

    if coalesce(public.is_admin(), false) is not true then
      raise exception '%', v_message || ' Only the owner can let it through.'
        using errcode = 'insufficient_privilege';
    end if;

    if nullif(btrim(coalesce(new.over_limit_reason, '')), '') is null then
      raise exception '%',
        'Write why this party is being allowed past its credit limit.'
        using errcode = 'check_violation';
    end if;
  else
    new.over_limit_approved_by := null;
    new.over_limit_reason := null;
  end if;

  return new;
end;
$$;

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
  if coalesce(public.is_admin(), false) is not true then
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
