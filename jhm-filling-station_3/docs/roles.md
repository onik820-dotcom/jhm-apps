# Roles and permissions

Four roles. Each one is enforced in three places, and the order matters:

1. **Postgres RLS** — the boundary that actually protects the money.
   `supabase/migrations/0006_rls.sql`.
2. **The server** — every page reads the caller's profile and refuses to render
   for the wrong role.
3. **The UI** — mutating controls are not drawn for roles that may not use them.

The UI check is a courtesy. If it were removed entirely, nothing would leak,
because the first two would still hold.

---

## dispenser — the forecourt employee

The most restricted role. This person is standing at a pump with a phone.

**Can do, and nothing else:**

- Photograph a dispenser meter; the AI reads the machine number and the
  totalizer, and the employee confirms or retypes it.
- Enter a tank dip in millimetres for either tank at shift closing.
- Enter a tank dip before and after a tanker refill.
- See their own submissions from the shift they are currently in.

**Cannot see:** any money, any rate, any profit, any total, any customer, any
other employee's submissions, or any record from a shift other than the current
one.

**Cannot do:** edit or delete anything, including their own submissions. A
mistake is corrected by the manager, which leaves both the original and the
correction in the audit trail.

### How that is enforced

`shifts` carries `rate_per_litre`, so the table itself is closed to this role
entirely. The three-button screen gets the shift it needs from
`public.current_shift_info()`, a SECURITY DEFINER function that returns only the
date, type, start, end and status — no rate, no totals.

Writes to `meter_readings` and `tank_dips` are admitted only when
`recorded_by = auth.uid()` **and** `shift_id = public.current_shift_id()`.
Reads are restricted the same way, so yesterday's rows are invisible.

---

## manager — the pump manager

Enters everything that needs judgement.

- Reviews, corrects and approves dispenser submissions.
- Sets or confirms the diesel selling rate for the shift.
- Enters party-wise credit sales, lubricant sales, and test/assessment litres.
- Records tanker refills compartment by compartment, with PO, challan and depot
  rate.
- Records expenses, dues collected, cash counted and bank deposits.
- Runs the shift close and signs it off.
- Views operational reports.

**Cannot:** see blended cost or profit — `tank_cost_history` is admin and MD
only, so a manager sees the depot rate on a delivery they entered but never the
rolled-up cost of stock or the margin on a sale. **Cannot delete anything.**
**Cannot reopen a closed shift.**

---

## admin — accounts / owner

Everything a manager can do, plus:

- Full profit and loss: day, month, year, per tank, per dispenser, per product,
  per credit customer.
- Edit and remove any record. Removal is always a soft delete with a reason,
  recorded in the audit log.
- Add, pause and remove tanks and dispensers. These controls exist only for this
  role.
- Manage users and roles, credit customers and limits, lubricant SKUs, expense
  categories, rate history and variance thresholds.
- Upload a new BSTI calibration chart when a tank is re-calibrated.
- Reopen a closed shift, with a reason — which triggers
  `recalculate_from()` for every later shift.
- Read the audit log.

**Cannot:** hard-delete anything, or alter the audit log. Both are refused by
trigger, not merely by policy, so neither a service-role key nor a SQL console
can erase history.

---

## md — Managing Director

**Strictly read-only, live.** SELECT policies and nothing else, anywhere in the
schema. There is no INSERT, UPDATE or DELETE policy that can ever admit this
role, and `public.assert_md_is_read_only()` returns zero rows as proof —
`npm run verify:rls` checks it on every run.

- A dashboard that updates in realtime through a Supabase Realtime subscription.
- Today's sales, cash position, stock cover, open variance, dues outstanding,
  month-to-date profit.
- Can open any report.

The MD dashboard has no interactive control beyond choosing a date range and
opening a report.

---

## Route access

Enforced in `middleware.ts` from the table in `lib/roles.ts`. A role that opens a
path it may not see is redirected to its own home rather than shown an error.

| Route | dispenser | manager | admin | md |
|---|:--:|:--:|:--:|:--:|
| `/dispenser` | ✓ | | | |
| `/manager` | | ✓ | ✓ | |
| `/admin` | | | ✓ | |
| `/md` | | | | ✓ |
| `/stock`, `/shift`, `/refill` | | ✓ | ✓ | |
| `/cash`, `/dues`, `/expenses`, `/lubricants` | | ✓ | ✓ | |
| `/reports` | | ✓ | ✓ | ✓ |
| `/audit`, `/settings` | | | ✓ | |

---

## Deletion, everywhere

No table in this schema has a DELETE policy for any role. Removal is an UPDATE
that sets `deleted_at`, `deleted_by` and `delete_reason`, and the audit trigger
records the row as it was and as it became.

On the tables that must never lose a row — calibration charts, shifts, readings,
dips, sales, stock, deliveries, ledger entries, expenses, cash and bank rows — a
`BEFORE DELETE` trigger refuses a hard delete outright.

---

## Verifying it

```bash
npm run verify:rls
```

Signs in as each seeded role and checks what it can reach. The check Phase 1 is
judged on is the first one: a `dispenser` cannot select from `expenses`.

---

## The assistant

The chat panel is on every screen except the dispenser's, and it has **no
privileges of its own**. Every question it answers runs on the asker's own
Supabase session, so Row Level Security answers exactly as it would if they had
opened the screen.

| | manager | admin | md | dispenser |
|---|---|---|---|---|
| Panel appears | yes | yes | yes | **no** |
| Today's sales, litres, cash, dues | yes | yes | yes | — |
| What a party owes | yes | yes | yes | — |
| Tank stock and variance | yes | yes | yes | — |
| **Profit** | **refused** | yes | yes | — |

A manager asking *"ei mash e profit koto?"* gets the database's own refusal —
*"Profit is shown to the owner and the MD only"* — because
`public.profit_and_loss()` raises for them, and the assistant is told to relay
a refusal rather than work around it.

This is why the chat does **not** go through n8n, which Section 6.11 of the
brief describes. For n8n to answer a question about live data it would query
Supabase with a service-role key, bypassing RLS entirely, and every boundary in
this table would be one question away from collapsing. Prompting a model not to
reveal something is a wish; letting the database refuse is a rule.

### It cannot write

There is no mutating tool. A spoken *"log 500 taka for tiffin"* produces a
**proposal** — a card listing every field — and nothing is saved until a person
taps it. The confirmation then goes through the same server action the form
uses, with the same validation, the same triggers, the same RLS and the same
audit row. Arriving by voice earns no shortcut.

Closing a shift by chat deliberately does not close the shift: that needs meter
readings and dips read off machines, so the card takes you to the wizard. It
would otherwise be the only place in the system where a figure appeared without
somebody reading it off a machine.

---

## Reports

`lib/reports/registry.ts` holds one definition per report, including which
roles may open it. The role check is enforced in three places, not one: the
page falls back to a report the role may see, the Excel route answers `403`,
and the underlying database function refuses.

| Report | manager | admin | md |
|---|---|---|---|
| Daily Sheet, shift reconciliation, stock variance | yes | yes | yes |
| Purchase, sales, ageing, expenses, cash book | yes | yes | yes |
| Dispenser performance, lubricant movement | yes | yes | yes |
| **Profit & Loss** | **no** | yes | yes |
| **Audit log** | **no** | yes | **no** |

Cost columns — the depot rate and the value of a delivery — are stripped from
the purchase register for anyone who may not see cost, in the same pass that
builds the table and the workbook, so the figure never reaches the browser.

---

## Expenses, and the three books

| Book | Who records it | Shown to |
|---|---|---|
| Pump | manager, admin | manager, admin, md |
| Own use | **nobody** — written by the lubricant module when oil is issued | manager, admin, md |
| Chairman | admin | manager, admin, md |

The Own use book is read-only on screen. Its rows come from
`book_own_use_expense()` when oil leaves the shelf for a station lorry, so the
expense form never offers that head — an expense typed there would be oil
nobody actually issued.
