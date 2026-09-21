# Calculations

Every formula the system relies on, with a worked example using real figures
from the station's certified charts.

Each one exists twice: as a pure function in `lib/calc/` and, where it affects
stock, as a Postgres function in `supabase/migrations/0004_functions.sql`. They
are written from this document, so this document is the reference when they
disagree.

**Scales.** Money is `NUMERIC(14,2)` — taka to two decimals. Volume is
`NUMERIC(12,3)` — litres to three. Cost per litre is carried at four decimals,
because rounding it to paisa drifts measurably across a 12,000 L tank. No
calculation anywhere uses a JavaScript float: the client uses `decimal.js`, the
database uses `NUMERIC`.

---

## 1. Dispenser meter → litres sold

`lib/calc/meter.ts` · `litresSold()`

A mechanical totalizer counts for the life of the pump. A shift's sale is the
difference between two readings.

```
litres_sold = closing_reading − opening_reading
opening_reading = the previous shift's closing_reading for that same nozzle
```

**Worked example.** Nozzle M1-N1 opened at 1,234,567.89 and closed at
1,236,789.01.

```
1,236,789.01 − 1,234,567.89 = 2,221.12 L
```

### Rollover

Totalizers wrap at a fixed digit count, stored per nozzle in
`dispensers.meter_digits` (default 8, so the largest reading is 99,999,999.99).
When the closing reading is *lower* than the opening one, the meter has wrapped:

```
litres_sold = (10^meter_digits − opening) + closing
```

**Worked example.** An 8-digit meter opened at 99,999,950 and closed at 100.

```
(100,000,000 − 99,999,950) + 100 = 50 + 100 = 150 L
```

A rollover is rare and is far more often a typo, so it is flagged
(`meter_readings.is_rollover`) and the manager must confirm it before the shift
closes.

### Sanity guard

A reading that implies more fuel than the nozzle could physically pump is
refused rather than saved quietly:

```
max_possible = max_flow_lpm × shift_minutes
```

At 50 L/min over a 12-hour shift that ceiling is 36,000 L. A reading implying
40,000 L is returned to the manager to confirm or correct.

---

## 2. Net sale for the shift

`lib/calc/sales.ts` · `shiftSale()`

```
gross_litres  = Σ litres_sold over every nozzle in the shift
net_litres    = gross_litres − test_litres
sales_amount  = net_litres × rate_per_litre
```

`test_litres` is the paper sheet's *Test / Assessment* row: fuel pumped into the
test measure and poured back into the tank. It leaves the dispenser but comes
back, so it is excluded from sales **and** stays in tank stock.

**Worked example.** Gross 4,520.500 L, test 20.500 L, rate ৳109.00.

```
net   = 4,520.500 − 20.500 = 4,500.000 L
sales = 4,500.000 × 109.00 = ৳490,500.00
```

---

## 3. Tank dip → litres

`lib/calc/dip.ts` · `dipToLitres()` · mirrored as `public.dip_to_litres()`

Each tank has a BSTI-certified chart mapping dip in millimetres to litres at 1 mm
granularity. **The chart is the legal reference and is never replaced by a
cylinder formula** — the real tanks have dished ends and the certified figures
deviate from the ideal cylinder by up to about 2%.

Both tanks hold 12,000 L, but their dip ranges differ, and that difference
matters:

| Tank | Dip range | Full at | Rows |
|---|---|---|---|
| T1 | 1–2070 mm | **2070 mm** | 2,070 |
| T2 | 1–2051 mm | **2051 mm** | 2,051 |

`final_dip_mm` is a per-tank column in `tank_metadata`. Every bound check reads
it from that tank's own record; 2070 is never treated as a global maximum. A dip
of 2051 mm is *full* on Tank 2 and an ordinary mid-chart reading on Tank 1.

- An integer dip is an **exact table lookup**.
- A dip read between marks is **linearly interpolated** between the two
  bracketing certified rows.
- A dip below 1 mm or above that tank's `final_dip_mm` is rejected.
- A chart is refused at import unless it is strictly increasing and covers every
  millimetre with no gaps.

**Worked example — exact.** Tank 1 at 1450 mm → **8,455.000 L** (certified row).

**Worked example — interpolated.** Tank 1 reads 1450.5 mm. The bracketing rows
are 1450 mm = 8,455 L and 1451 mm = 8,462 L:

```
8,455 + (8,462 − 8,455) × 0.5 = 8,455 + 3.5 = 8,458.500 L
```

**Ullage** is the empty space: `capacity − litres_at_dip`. Tank 1 at 1450 mm has
12,000 − 8,455 = 3,545.000 L of headroom.

### Versions and expiry

Charts carry `valid_from` and `valid_to`. JHM's current charts run
**31-01-2022 → 30-01-2027**. A dip always resolves against the version in force
on its *own* timestamp, so re-calibrating a tank never retroactively restates a
closed shift. Each `tank_dips` row stores the version it was resolved against.

The admin dashboard warns 90 days before expiry, and dip entry is blocked
against an expired version unless an admin overrides with a reason.

---

## 4. Book stock, physical stock and variance

`lib/calc/stock.ts` · `tankStock()` · mirrored in `public.enforce_stock_chain()`

Run per tank, per shift.

```
book_opening   = previous shift's book_closing for that tank
book_closing   = book_opening + refill_litres − sold_from_tank
physical_closing = dip_to_litres(tank, closing_dip_mm)

variance_litres = physical_closing − book_closing
variance_pct    = variance_litres / sold_from_tank × 100
```

`sold_from_tank` is the net litres sold by every dispenser mapped to that tank
through `dispensers.tank_id`. Without that mapping, per-tank variance cannot be
computed at all.

**Worked example.** Tank 1 opened at 8,000 L, took no delivery, sold 4,000 L, and
the closing dip converted to 3,980 L.

```
book_closing    = 8,000 + 0 − 4,000 = 4,000.000 L
variance_litres = 3,980 − 4,000     = −20.000 L
variance_pct    = −20 / 4,000 × 100 = −0.50%
```

At the default threshold of ±0.5% that sits exactly on the line and does not
alert. A closing dip of 3,960 L would be −1.00% — past the threshold, so it
raises an alert, fires the n8n webhook immediately, and blocks sign-off until
the manager writes a reason.

### The rod floor

A percentage alone is not enough, because the same physical error becomes a
different percentage depending on how busy the shift was.

From the certified charts, across the working range of 400–1600 mm, **one
millimetre of dip rod is 6.87 litres** on both tanks. Only one figure in a close
is read off a rod: `book_opening` is carried forward from the previous shift
and already reconciled, while `physical_closing` is a wet line read by eye. So
the measurement error on a variance is about ±7 litres.

```
flagged = |variance_litres| > variance_floor_litres
          AND |variance_pct| > variance_threshold_pct
```

**Worked example, two shifts with the same physical error.**

```
quiet shift   sold 200 L, out by 5 L    = 2.50%   not flagged — 5 L < 7 L floor
busy shift    sold 5,000 L, out by 26 L = 0.52%   flagged — past both tests
```

Without the floor the first shift alerts every quiet night, and a manager who
writes "rod reading" in the reason box every night learns that the box is a
formality. The reason box is only worth having if it is rare.

When nothing was sold from a tank, a percentage would be meaningless, so it is
recorded as null — but movement past the floor is still flagged, because
stock that moves with nothing sold is a leak, an unrecorded delivery or a
theft, never rod noise.

The rule lives in one place, `public.variance_is_flagged()`, called by the
chain trigger, by `recalculate_from()` and by `compute_shift_close()`. It was
written out three times before Phase 9, and three copies of a threshold are
three thresholds waiting to disagree.

### The chain must not break

Shift N's `book_closing` **is** shift N+1's `book_opening`, per tank. A trigger
refuses any row that breaks the chain, and `findChainBreaks()` reports exactly
where a break occurred.

When an earlier shift is corrected or reopened, `public.recalculate_from(shift_id)`
re-derives the opening and closing figures for every later shift, per tank.
Sales and refills stay as recorded; only the book figures move.

**Worked example.** Three shifts run 10,000 → 8,000 → 14,000 → 11,500 L. If the
opening stock is corrected upward by 50 L, every later closing moves by the same
50 L: 8,050 → 14,050 → 11,550, and the first shift now shows a −50 L variance
against its measured dip.

---

## 5. Tanker refill

`lib/calc/refill.ts` · `compartmentReceipt()`

A road tanker arrives with 4 compartments of 4,500 L — 18,000 L declared. What
matters is what the tank's own rod says arrived, not what the challan claims.

```
received_litres(compartment) = dip_to_litres(tank, dip_after) − dip_to_litres(tank, dip_before)
shortage(compartment)        = declared_litres − received_litres
truck_total_received         = Σ received over all four compartments
purchase_value               = received_litres × depot_rate_per_litre
```

**Worked example.** Compartment 1 discharges into Tank 1. The dip before reads
1000 mm (5,163 L certified) and after reads the row holding 9,663 L.

```
received = 9,663 − 5,163 = 4,500.000 L
shortage = 4,500 − 4,500 = 0.000 L
```

Shortage past the tolerance (default 0.3% of declared, so 13.5 L on a 4,500 L
compartment) is flagged for a claim against the depot. Note that reading the rod
to the nearest whole millimetre is itself worth 4–8 L at these levels, which is
why the tolerance is not zero.

**Overfill guard.** Before a compartment is discharged:

```
safe_limit = capacity × 95%
willOverfill = current_litres + incoming > safe_limit
```

Tank 1 at 2000 mm already holds 11,730 L against a safe limit of 11,400 L, so
another 4,500 L is refused before it is poured.

The purchase is always valued on litres **received**, never litres declared.

---

## 6. Costing and profit

`lib/calc/cost.ts` · `movingAverageCost()` · mirrored as `public.moving_average_cost()`

Cost is a **moving weighted average per tank**. Depot rates change between
deliveries, and FIFO layers are not how the business thinks about the fuel in a
tank.

```
new_avg_cost = ((old_stock × old_avg_cost) + (received × depot_rate)) / (old_stock + received)
```

**Worked example.** A tank holds 5,000 L costed at ৳100.0000 and receives 9,000 L
at a depot rate of ৳106.00.

```
(5,000 × 100.0000 + 9,000 × 106.00) / 14,000
= (500,000 + 954,000) / 14,000
= 1,454,000 / 14,000
= ৳103.8571 per litre
```

When the tank was empty, the new average is simply the depot rate. When nothing
is received, the average is unchanged.

```
diesel_revenue      = net_litres × selling_rate
diesel_cogs         = Σ per shift, per tank:
                        sold_from_tank × tank_cost_at(tank, shift_ends_at)
diesel_gross_profit = diesel_revenue − diesel_cogs

lubricant_gross_profit = Σ (sale_amount − qty × avg_cost) per SKU

gross_profit     = diesel_gross_profit + lubricant_gross_profit
operating_profit = gross_profit − pump_expenses − own_use
after_drawings   = operating_profit − chairman_drawings
```

Fuel is costed **shift by shift at the average in force when that shift
closed**, not at today's average. Costing a month at one rate would be wrong in
both directions: it overstates profit in a falling market and understates it in
a rising one.

### Three books, never summed into one

| Book | What it is | Where it sits |
|---|---|---|
| Pump | What the station spends to run — salaries, electricity, repairs | Above the operating line |
| Own use | Oil the station put into its own lorries, at cost | Above the operating line, on its own row |
| Chairman | What the owner draws out | **Below** the operating line |

The Chairman book is a distribution of profit, not a cost of selling diesel.
Folding it in would make the pump look unprofitable in a month the owner
happened to take more out.

Own use is a real cost — the oil left the business — so it comes off operating
profit. It gets its own row rather than enlarging the Pump book, because it is
not something the manager is accountable for. It is **never** revenue: counting
it as a sale would invent a margin on oil nobody paid for, and count it twice.

**Worked example.** 4,500 L sold at ৳109.00 against an average cost of ৳103.8571.

```
revenue      = 4,500 × 109.00     = ৳490,500.00
cogs         = 4,500 × 103.8571   = ৳467,356.95
gross profit =                      ৳23,143.05   (4.72% margin)
```

Add ৳1,800.00 of lubricant margin, ৳7,250.50 of pump expenses, ৳1,458.00 of
own use and ৳15,000.00 of owner drawings:

```
gross profit     = 23,143.05 + 1,800.00            = ৳24,943.05
operating profit = 24,943.05 − 7,250.50 − 1,458.00 = ৳16,234.55
after drawings   = 16,234.55 − 15,000.00           = ৳1,234.55
```

### When the cost is not known

A tank that has never taken a valued delivery has no cost history, and costing
its litres at zero would report the whole sale as profit. Those litres are held
out of the calculation entirely and reported as `uncosted_litres`, with a
notice on the statement. While that figure is above zero the margin is
overstated, and the report says so rather than quietly flattering itself.

Profit is visible to **admin and MD only** — enforced in
`public.profit_and_loss()`, which raises `insufficient_privilege` for any
other role. That is why the chat assistant cannot be talked into revealing it:
the refusal comes from the database, not from a prompt.

---

## 7. Cash reconciliation

`lib/calc/cash.ts` · `reconcileCash()`

```
total_sales   = diesel_sales + lubricant_sales
credit_sales  = Σ party-wise credit sales for the shift
cash_sales    = total_sales − credit_sales

expected_cash = opening_cash + cash_sales + dues_collected
                − expenses_paid_cash − bank_deposits
cash_variance = counted_cash − expected_cash
```

**Worked example.** Opening ৳25,000.00, cash sales ৳350,000.00, dues collected
৳40,000.00, cash expenses ৳12,500.00, bank deposit ৳300,000.00.

```
expected = 25,000 + 350,000 + 40,000 − 12,500 − 300,000 = ৳102,500.00
```

If the drawer counts ৳102,500.00 the shift closes clean. If it counts
৳102,499.50, the variance is −৳0.50 — small, but it still blocks a clean close
until the manager writes a reason. The default tolerance is zero: the system
never rounds a difference away.

### Customer ledger

Debit raises what a party owes; credit reduces it. `running_balance` is
maintained by a trigger on write and never recomputed on read.

```
running_balance = previous_entry.running_balance + debit − credit
```

A credit sale of ৳10,899.55 followed by a part payment of ৳5,000.00 leaves
৳5,899.55 outstanding.

**"Previous" means the previous `entry_seq`, never the previous timestamp.**
`now()` does not advance inside a transaction, so several entries written
together share an `entry_at` to the microsecond. Ordering by timestamp then
falls back to a random UUID, and each insert reads whichever earlier row
happens to sort highest rather than the one actually before it. Five ৳1,000
sales posted in one close left a party owing ৳2,000 — ৳3,000 gone, with every
document still on file. `entry_seq` is assigned by the database in insertion
order, and the advisory lock held per customer makes that order the order the
money moved.

### Credit limits

```
projected = current_balance + sale_amount
blocked   = credit_limit > 0 AND projected > credit_limit
```

A limit of **zero means no limit has been agreed**, not a limit of nothing. A
sale that lands exactly on the limit is allowed; one taka past it is not.

A manager is blocked outright. An admin may record it anyway with a written
reason, which is kept on the sale and raises an alert — refusing outright would
just mean the sale is written on paper and never reaches the system, which is
worse. The approval must be the person at the keyboard, so a manager cannot
type the owner's id into the field and approve their own sale.

### Ageing

Payments are applied **oldest bill first**, which is how both the station and
the parties think about it. The running total does the allocation without a
loop: an item is still outstanding for whatever part of it sits above the total
paid.

```
outstanding(item) = max(0, min(item.amount, cumulative_to_here − total_paid))
```

**Worked example.** A party carries ৳10,000 owed since 120 days ago, then buys
৳25,000 on credit and pays ৳15,000.

```
opening  ৳10,000  cumulative 10,000   10,000 − 15,000 < 0  → cleared
sale     ৳25,000  cumulative 35,000   35,000 − 15,000 = 20,000 outstanding
```

So the 90+ bucket is empty and ৳20,000 sits in 0–30. The payment cleared the
oldest debt first, which is the whole point of the report.

Buckets are 0–30, 31–60, 61–90 and 90+ days. The opening balance is aged from
`customers.opening_balance_as_of`; without that date it is aged from the day
the party was created, and the screen says so — otherwise a year-old debt looks
identical to last Tuesday's.

The bucket totals deliberately need not sum to the balance. A party in advance
shows a negative balance and empty buckets, because nothing is overdue.

---

## 8. Stock cover

`lib/calc/cover.ts` · `stockCover()`

```
avg_daily_sale = mean(net_litres) over the last 7 closed days
days_cover     = (tank1_physical + tank2_physical) / avg_daily_sale
```

**Worked example.** A seven-day average of 9,000 L/day against 14,655 L on hand:

```
14,655 / 9,000 = 1.63 days
```

Below the configured threshold (default 3 days), so an alert goes out and a
purchase order needs to be raised. With no sales history the figure is reported
as null rather than as infinity.

---

## Thresholds

All are stored in `settings` and changeable without a deploy. The values below
are the defaults seeded at install.

| Setting | Default | Effect |
|---|---|---|
| `variance_threshold_pct` | 0.5 | Stock variance past this raises an alert and blocks a clean close |
| `variance_floor_litres` | 7 | Below this, a variance is never flagged — one millimetre of dip rod is 6.87 L |
| `shortage_tolerance_pct` | 0.3 | Tanker compartment shortage past this is flagged |
| `overfill_limit_pct` | 95 | A compartment may not fill a tank past this |
| `cover_alert_days` | 3 | Days of cover below which a PO is due |
| `cash_variance_tolerance` | 0 | Taka difference treated as a clean close |
| `chart_expiry_warning_days` | 90 | When the calibration expiry warning starts |
| `sync_max_attempts` | 5 | Outbound mirror attempts before the event is failed and an alert raised |

---

## Time

All timestamps are `timestamptz`. All business logic runs in **Asia/Dhaka**.

A business day runs **06:00 → 06:00**, not midnight to midnight. The night shift
spans two calendar dates and is attributed to the date it opened on, so a shift
closing at 05:30 still belongs to the previous day. This is
`public.business_date()` in the database and `businessDate()` in `lib/format.ts`,
and the two are tested against the same boundary cases.
