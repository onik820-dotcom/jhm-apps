-- ============================================================================
-- 0029 — A tolerance the rod can actually support
--
-- Asked what the variance tolerance should be, the answer was "whatever makes
-- the counting accurate". So this starts from what the station can measure
-- rather than from a number that sounds strict.
--
-- WHAT ONE MILLIMETRE IS WORTH
--
-- From the certified charts, across the working range of 400–1600 mm:
--
--     T1   6.87 litres per millimetre    T2   6.87 litres per millimetre
--
-- A shift close compares two figures, but only one of them is read off a rod.
-- `book_opening` is carried forward from the previous shift's closing — a
-- computed number, already reconciled. `physical_closing` is a wet line read
-- by eye against a dipstick on a forecourt. So the measurement error on a
-- shift's variance is one reading, not two: about ±7 litres for a rod read to
-- the nearest millimetre.
--
-- WHY A PERCENTAGE ALONE MISBEHAVES
--
-- The percentage is taken against litres sold, so the same physical error
-- becomes a different percentage depending on how busy the shift was:
--
--     5 L out on a quiet 200 L shift    = 2.5%   flagged, but it is rod noise
--     25 L out on a busy 5,000 L shift  = 0.5%   not flagged, and it is real
--
-- The first case is the damaging one. A manager who writes "rod reading" in
-- the reason box every quiet night learns that the box is a formality, and on
-- the one night it matters the note says the same thing.
--
-- So: a variance is flagged when it is BOTH past the percentage AND bigger
-- than a single millimetre of rod. Below that floor the figure cannot be told
-- apart from how the rod was read, and treating it as a finding is not
-- accuracy — it is noise wearing accuracy's clothes.
--
-- Both figures the business has already seen still flag: Phase 4's injected
-- 9.6 L at 0.96%, and the demo day's 11 L at 0.63%.
--
-- THE RULE MOVES INTO ONE FUNCTION
--
-- It was written out three times — in enforce_stock_chain, in
-- recalculate_from and in compute_shift_close. Three copies of a threshold are
-- three thresholds waiting to disagree, and the one that drifts is the one
-- nobody is looking at.
-- ============================================================================

insert into public.settings (station_id, key, value, description)
values (
  (select id from public.stations limit 1),
  'variance_floor_litres',
  '{"value": 7}',
  'Below this many litres a variance is not flagged, whatever the percentage '
  'says: one millimetre of dip rod is 6.87 L on both tanks, so anything '
  'smaller cannot be told apart from how the rod was read. Raise it if the '
  'rods are read to the nearest 2 mm in practice.')
on conflict (station_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- The rule, in one place
-- ---------------------------------------------------------------------------
create or replace function public.variance_is_flagged(
  p_variance_litres numeric,
  p_variance_pct numeric)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    -- No physical count, so nothing to compare against.
    when p_variance_litres is null then false
    -- Inside the rod's own precision. Not a finding.
    when abs(p_variance_litres)
         <= public.setting_numeric('variance_floor_litres', 7) then false
    -- Nothing sold, yet the stock moved by more than a rod reading. That is
    -- never noise — it is a leak, an unrecorded delivery, or a theft.
    when p_variance_pct is null then true
    else abs(p_variance_pct) > public.setting_numeric('variance_threshold_pct', 0.5)
  end
$$;

comment on function public.variance_is_flagged(numeric, numeric) is
  'Whether a stock variance needs a written reason: past the percentage AND '
  'bigger than one millimetre of dip rod. The single source of this rule — '
  'enforce_stock_chain, recalculate_from and compute_shift_close all call it.';

revoke execute on function public.variance_is_flagged(numeric, numeric) from anon, public;
grant execute on function public.variance_is_flagged(numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- The chain trigger asks the function. Everything else about it is unchanged
-- from 0004 — the chain check and the book_closing identity both still stand.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_stock_chain()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_starts_at timestamptz;
  v_prev public.shift_stock;
begin
  -- recalculate_from() rewrites the chain deliberately and sets this flag.
  if coalesce(current_setting('app.recalculating', true), 'off') = 'on' then
    return new;
  end if;

  select starts_at into v_starts_at from public.shifts where id = new.shift_id;
  v_prev := public.previous_shift_stock(new.tank_id, v_starts_at);

  if v_prev.id is not null and round(v_prev.book_closing, 3) <> round(new.book_opening, 3) then
    raise exception
      'Stock chain break on tank %: opening % L does not match the previous shift closing of % L. '
      'Correct the earlier shift and run recalculate_from().',
      (select code from public.tanks where id = new.tank_id),
      round(new.book_opening, 3), round(v_prev.book_closing, 3)
      using errcode = 'check_violation';
  end if;

  -- book_closing = book_opening + refills − sold
  if round(new.book_closing, 3)
     <> round(new.book_opening + new.refill_litres - new.sold_from_tank, 3) then
    raise exception 'book_closing must equal book_opening + refill_litres - sold_from_tank'
      using errcode = 'check_violation';
  end if;

  if new.physical_closing is not null then
    new.variance_litres := round(new.physical_closing - new.book_closing, 3);
    new.variance_pct := case
      when new.sold_from_tank = 0 then null
      else round(new.variance_litres / new.sold_from_tank * 100, 4)
    end;
    new.variance_flagged := public.variance_is_flagged(new.variance_litres, new.variance_pct);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_shift_stock_chain on public.shift_stock;
create trigger trg_shift_stock_chain
  before insert or update on public.shift_stock
  for each row execute function public.enforce_stock_chain();

-- ---------------------------------------------------------------------------
-- recalculate_from asks it too, so a rebuilt chain flags the same shifts a
-- freshly closed one would. Unchanged from 0004 apart from that one line and
-- the now-unused threshold local.
-- ---------------------------------------------------------------------------
create or replace function public.recalculate_from(p_shift_id uuid)
returns table (
  out_shift_id       uuid,
  out_tank_id        uuid,
  out_book_opening   numeric,
  out_book_closing   numeric,
  out_variance_litres numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from      timestamptz;
  r_tank      record;
  r_row       record;
  v_opening   numeric;
  v_closing   numeric;
  v_variance  numeric;
  v_pct       numeric;
begin
  if not public.is_admin() then
    raise exception 'Only an admin may recalculate the stock chain' using errcode = 'insufficient_privilege';
  end if;

  select starts_at into v_from from public.shifts where id = p_shift_id;
  if v_from is null then
    raise exception 'Unknown shift %', p_shift_id using errcode = 'no_data_found';
  end if;

  -- The chain is being rewritten on purpose, so the guard trigger stands down
  -- for this transaction only.
  perform set_config('app.recalculating', 'on', true);

  for r_tank in
    select t.id from public.tanks t where t.deleted_at is null order by t.code
  loop
    -- Start from the last closing before the edited shift. When the edited
    -- shift is the very first one for this tank, its own opening stands.
    v_opening := (
      select ss.book_closing
      from public.shift_stock ss
      join public.shifts s on s.id = ss.shift_id
      where ss.tank_id = r_tank.id and s.starts_at < v_from
      order by s.starts_at desc
      limit 1
    );

    if v_opening is null then
      v_opening := (
        select ss.book_opening
        from public.shift_stock ss
        join public.shifts s on s.id = ss.shift_id
        where ss.tank_id = r_tank.id and s.starts_at >= v_from
        order by s.starts_at asc
        limit 1
      );
    end if;

    continue when v_opening is null;

    for r_row in
      select ss.id, ss.shift_id, ss.refill_litres, ss.sold_from_tank, ss.physical_closing
      from public.shift_stock ss
      join public.shifts s on s.id = ss.shift_id
      where ss.tank_id = r_tank.id and s.starts_at >= v_from
      order by s.starts_at asc
    loop
      v_closing := round(v_opening + r_row.refill_litres - r_row.sold_from_tank, 3);

      if r_row.physical_closing is null then
        v_variance := null;
        v_pct := null;
      else
        v_variance := round(r_row.physical_closing - v_closing, 3);
        v_pct := case
          when r_row.sold_from_tank = 0 then null
          else round(v_variance / r_row.sold_from_tank * 100, 4)
        end;
      end if;

      update public.shift_stock
      set book_opening     = v_opening,
          book_closing     = v_closing,
          variance_litres  = v_variance,
          variance_pct     = v_pct,
          variance_flagged = public.variance_is_flagged(v_variance, v_pct),
          updated_at = now()
      where id = r_row.id;

      out_shift_id        := r_row.shift_id;
      out_tank_id         := r_tank.id;
      out_book_opening    := v_opening;
      out_book_closing    := v_closing;
      out_variance_litres := v_variance;
      return next;

      v_opening := v_closing;
    end loop;
  end loop;

  perform set_config('app.recalculating', 'off', true);
  return;
end;
$$;

comment on function public.recalculate_from(uuid) is
  'Admin-only. Rewrites book_opening/book_closing for every shift from the '
  'given shift forward, per tank. Called after a shift is reopened or edited.';

-- ---------------------------------------------------------------------------
-- Own-use gets a book of its own
--
-- Oil issued to the station's own lorries is neither a running cost the
-- manager is accountable for nor money the owner drew. Its own group means it
-- is reported on its own line instead of disappearing into one of the two
-- books.
--
-- The enum value is added here and used in 0030: Postgres will not let a new
-- enum value be used in the same transaction that created it.
-- ---------------------------------------------------------------------------
alter type public.expense_group add value if not exists 'own_use';
