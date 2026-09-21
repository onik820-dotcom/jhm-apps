# The demo trading day

`scripts/seed-demo-day.ts` builds one complete business day so the reports have
something to be right about. A report screen on an empty database proves
nothing: every total is zero and every total agrees.

```bash
npm run seed:demo
```

It writes through the real RPCs — `record_tanker_delivery()` and
`close_shift()`, the same ones the screens call — rather than inserting rows
directly. Data that skipped the triggers would tell us the reports work when
they only work on data nothing checked.

## What it builds

Default date `2026-09-18`; override with `DEMO_DATE=2026-10-01 npm run seed:demo`.

| | |
|---|---|
| Three credit parties | one at 45 days, one at 95 days, one new, all prefixed `DEMO` |
| A tanker at 07:40 | 4 × 4,500 L declared, 41 L short across the four compartments, at ৳102.40 |
| Day shift 06:00–18:00 | four nozzles, 5 L into the test measure, two credit sales, two expenses |
| Night shift 18:00–06:00 | one credit sale, a ৳25,000 cash collection, a chairman drawing |
| Lubricants | 40 L bought, 12 L sold, 3 L into a station lorry as own use |
| Variance | −4 L on T1 in the day, −11 L on T2 at night, so the flagged paths are exercised |

Selling rate ৳106.25, depot rate ৳102.40 — a margin of ৳3.85 a litre, which is
what the P&L should come back with.

## Removing it

Deliberately not done from the script. Removing a financial record needs the
`app.allow_hard_delete` escape hatch, and a script that can reach for it is a
script that can erase a real ledger. Run this by hand, in one transaction:

```sql
set local app.allow_hard_delete = 'on';

delete from public.meter_readings      where shift_id in (select id from public.shifts where shift_date = '2026-09-18');
delete from public.tank_dips           where shift_id in (select id from public.shifts where shift_date = '2026-09-18');
delete from public.tanker_compartments where delivery_id in (select id from public.tanker_deliveries where challan_no like 'DEMO-%');
delete from public.tank_cost_history   where trigger_delivery_id in (select id from public.tanker_deliveries where challan_no like 'DEMO-%');
delete from public.tanker_deliveries   where challan_no like 'DEMO-%';
delete from public.customer_ledger     where customer_id in (select id from public.customers where name like 'DEMO %');
delete from public.credit_sales        where customer_id in (select id from public.customers where name like 'DEMO %');
delete from public.payments            where customer_id in (select id from public.customers where name like 'DEMO %');
delete from public.customers           where name like 'DEMO %';
delete from public.lub_transactions    where shift_id in (select id from public.shifts where shift_date = '2026-09-18');
delete from public.expenses            where shift_id in (select id from public.shifts where shift_date = '2026-09-18');
delete from public.shift_sales         where shift_id in (select id from public.shifts where shift_date = '2026-09-18');
delete from public.shift_stock         where shift_id in (select id from public.shifts where shift_date = '2026-09-18');
delete from public.cash_reconciliation where shift_id in (select id from public.shifts where shift_date = '2026-09-18');
delete from public.alerts              where entity_ref->>'shift_id' in (select id::text from public.shifts where shift_date = '2026-09-18');
delete from public.sync_queue          where payload->'shift'->>'id' in (select id::text from public.shifts where shift_date = '2026-09-18');
delete from public.shifts              where shift_date = '2026-09-18';
update public.lub_stock set qty_on_hand = 0, avg_cost = 0;
```

The audit log keeps its record of all of it, which is the point: even removing
test data leaves a trail.

**Never run this against a database holding real trading.** It matches on a
date and a name prefix, and a real party called something beginning with DEMO
would go with it.
