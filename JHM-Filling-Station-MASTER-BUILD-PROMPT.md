# MASTER BUILD PROMPT — JHM Filling Station Unified ERP + POS + CRM

> **How to use this file.** Open Claude Code in an empty project folder and paste **Section 0 + Section 1–9** as your first message. Then work through **Section 10 (Build Phases)** one phase at a time, pasting the phase heading and saying "build this phase". Do not paste all phases at once — the app is too large for a single pass.
>
> Files that must be in the repo before you start: `seed/tank1_calibration.csv`, `seed/tank2_calibration.csv` (supplied alongside this prompt).

---

## SECTION 0 — ROLE AND PRIME DIRECTIVE

You are a senior full-stack engineer building a **production financial system** for a real fuel retail business in Bangladesh. Money and stock are reconciled against this app every 12 hours. Treat every calculation as auditable.

Three rules that override everything else:

1. **Never lose or silently change a number.** Every write is append-only with an audit trail. Edits and deletes are soft — they create a reversal record, they never mutate history.
2. **All money is `NUMERIC(14,2)`, all volume is `NUMERIC(12,3)`.** Never use JavaScript floats for money or litres. Use `decimal.js` on the client and Postgres `NUMERIC` in the database. Litres are stored to 3 decimals, taka to 2.
3. **A shift close must balance or be explicitly flagged.** If the numbers don't reconcile, the app records the variance and raises an alert — it never rounds the problem away.

---

## SECTION 1 — THE BUSINESS

**M/S. J.H.M. Filling Station**
Dealer of Padma Oil Company Limited
Jashore–Khulna Highway, Chengutia, Abhaynagar, Jashore, Bangladesh

| Fact | Value |
|---|---|
| Product | High Speed Diesel (HSD), plus lubricants/Mobil |
| Storage tanks | 2 × 12,000 L underground, BSTI-calibrated |
| Dispensers | 4 machines (expandable) |
| Shifts | Day 06:00–18:00, Night 18:00–06:00 |
| Closings per day | 2 (one per shift) |
| Currency | BDT (৳) |
| Languages | Bangla + English (both must work everywhere) |
| Credit customers | ~21 parties (transport, bricks, textiles, govt) |
| Expense categories | 17 in active use |

**Today this runs on paper and four disconnected Excel workbooks** (Pump Sheet, Can Lub, Due Customer Ledger, Espenditure). The meter reading, the tank dip, and the POS total are three independent numbers reconciled by hand every shift. This app replaces all of it.

The existing paper form, which the app must reproduce digitally, is headed *"JHM Filling Station, Chengutia, Noapara. Total Details as on Today"* and contains: Day Shift / Night Shift diesel litres + rate + amount; lubricant sales split Loose/Can; Total Sales; Credit Customers; Test/Assessment; Evolution of Stock; Cumulative Sales; Today's Credit Sales (party-wise); Pump Daily Expenses; Chairman's Daily Expenses; and five signature lines — Day Supervisor, Night Supervisor, Pump Manager, Account Manager, Approved/Authorized.

---

## SECTION 2 — STACK (LOCKED — do not substitute)

```
Framework    Next.js 15 (App Router) + TypeScript (strict)
UI           React 19, Tailwind CSS v4, shadcn/ui, lucide-react icons
Charts       Recharts
Database     Supabase (Postgres 15) — Auth, Row Level Security, Storage, Realtime
ORM/Client   @supabase/supabase-js + @supabase/ssr  (NO Prisma)
Decimals     decimal.js on client; NUMERIC in Postgres
Forms        react-hook-form + zod
State        TanStack Query v5
PWA          next-pwa (installable, offline queue via IndexedDB + idb-keyval)
AI vision    Anthropic Claude API (claude-sonnet-4-5) for meter OCR — server route only
Automation   n8n webhooks (outbound events + inbound chat)
Dates        date-fns + date-fns-tz, timezone Asia/Dhaka
Deploy       Vercel
```

**Hard constraints**
- The Anthropic API key lives **only** in a Next.js server route. Never expose it to the browser.
- Every table has RLS enabled. No table is readable without a policy.
- The app must be fully usable on a 360px-wide Android phone **and** a 1920px desktop.
- Bangla text must render correctly — load `Noto Sans Bengali` alongside `Inter`.

---

## SECTION 3 — ROLES AND PERMISSIONS

Four roles. Enforce in Postgres RLS **and** in the UI. Never rely on UI-only checks.

### 3.1 `dispenser` — the forecourt employee
The most restricted role. This person stands at the pump with a phone.

**Can do, and nothing else:**
- Open the camera and photograph a dispenser meter. AI reads the **machine number** and the **totalizer reading**; the employee confirms or retypes the reading, then saves.
- Enter a **tank dip measurement in mm** for Tank 1 and Tank 2 at shift closing.
- Enter a **tank dip measurement in mm** before and after a tanker refill.
- See their own submissions from the current shift.

**Cannot:** see any money, any rate, any profit, any other employee's data, any total, any customer, or any historical record beyond their current shift. No edit, no delete. Their screen is three big buttons and nothing else.

### 3.2 `manager` — the pump manager
Enters everything that requires judgement.

- Review, correct and approve dispenser submissions.
- Set/confirm the diesel selling rate for the shift.
- Enter party-wise credit sales, lubricant/Mobil sales, test-and-assessment litres.
- Record tanker refills (compartment by compartment) with PO/chalan and depot rate.
- Record expenses, dues collected, cash counted, bank deposits.
- **Run the shift close** and sign it off.
- View operational reports. Cannot see full P&L. Cannot delete anything.

### 3.3 `admin` — the accounts/owner role
Everything the manager can do, plus:

- Full **profit & loss** — day, month, year, per tank, per dispenser, per product.
- **Edit and remove** any record (soft delete, always audited, always with a reason).
- **Add / pause / remove tanks and dispensers.** This control appears only for admin.
- Manage users and roles, credit customers and credit limits, lubricant SKUs, expense categories, rate history, variance thresholds.
- Upload a new BSTI calibration chart when a tank is re-calibrated.
- View the audit log.

### 3.4 `md` — the Managing Director
**Strictly read-only, live.** No create, no update, no delete anywhere — enforce with RLS `SELECT`-only policies and hide every mutating control.

- A live dashboard that updates in realtime (Supabase Realtime subscription).
- Today's sales, cash position, stock cover, open variance, dues outstanding, month-to-date profit.
- Can open any report. Cannot change a single field.

---

## SECTION 4 — THE CRITICAL CALCULATIONS

These are the heart of the app. Implement each as a **pure, unit-tested TypeScript function** in `lib/calc/`, and mirror the stock-affecting ones as Postgres functions so the database can never drift from the UI.

### 4.1 Dispenser meter → litres sold

Mechanical totalizers are **lifetime cumulative**. A shift's sale is the difference.

```
litres_sold(nozzle) = closing_reading − opening_reading
opening_reading     = the previous shift's closing_reading for that same nozzle
```

**Rollover.** Totalizers wrap at a fixed digit count. Store `meter_digits` per nozzle (default 8, i.e. max 99,999,999.99). If `closing < opening`, then:
```
litres_sold = (10^meter_digits − opening) + closing
```
Flag any rollover for manager confirmation — it is rare and is more often a typo.

**Sanity guard.** Reject a reading that implies a sale above `max_flow_lpm × shift_minutes`. Ask the manager to confirm instead of saving silently.

### 4.2 Net sale for the shift

```
gross_litres = Σ litres_sold over every nozzle in the shift
test_litres  = litres pumped into the test measure and returned to the tank
net_litres   = gross_litres − test_litres
sales_amount = net_litres × rate_per_litre
```
`test_litres` is the paper sheet's "Test / Assessment" row. It leaves the dispenser but comes back to the tank, so it must be excluded from sales **and** added back to tank stock.

### 4.3 Tank dip → litres (BSTI calibration chart)

Each tank has a BSTI-certified chart mapping **dip in mm → quantity in litres**, 1 mm granularity. Both tanks hold 12,000 L, **but their dip ranges differ and this matters**:

| Tank | Dip range | Final dip = 12,000 L | Rows |
|---|---|---|---|
| Tank 1 | 1–2070 mm | **2070 mm** | 2,070 |
| Tank 2 | 1–2051 mm | **2051 mm** | 2,051 |

Never hard-code 2070 as "the" maximum. `final_dip_mm` is a per-tank column and every bound check reads it from the tank's own record.

- Seed both charts from `seed/tank1_calibration.csv` and `seed/tank2_calibration.csv` into `tank_calibration` (`tank_id, dip_mm, litres`). The CSVs have columns `tank_code, dip_mm, litres` and are complete — every integer millimetre from 1 to the tank's final dip, no gaps.
- Lookup is an **exact integer match** on `dip_mm`. Do not compute volume from a cylinder formula — the certified chart is the legal reference and it does **not** follow the ideal cylinder formula (it deviates by up to ~2% because of the dished ends).
- If a dip is recorded with a decimal (e.g. 1450.5 mm), **linearly interpolate** between the two bracketing integer rows.
- Reject a dip below 1 or above that tank's `final_dip_mm` with a clear error.
- On import, assert the chart is strictly monotonic increasing and has no gaps. Refuse to load a chart that fails either check.
- Charts are **versioned**: `valid_from`, `valid_to`. JHM's current charts are valid 31-01-2022 → 30-01-2027. A dip reading always resolves against the chart version in force on its own timestamp.

Tank 1 metadata to seed: capacity 12,000 L, length inside 3160 mm, diameter inside 2200 mm, gross height 2380 mm, final dip 2070 mm, dip pipe length 1620 mm, dip pipe diameter 50 mm, manhole 600 mm, calibration method API, calibrated by Md. Almas Mia, Inspector (Metrology), BSTI Khulna, calibration date 02-02-2022, previous calibration 26-10-2016, validity 31-01-2022 → 30-01-2027.

Tank 2 metadata to seed: capacity 12,000 L, final dip 2051 mm, same BSTI office and validity window.

**Because both charts expire 30-01-2027**, the app must warn on the admin dashboard 90 days before expiry and block new dip entries against an expired chart version unless admin overrides with a reason.

### 4.4 Book stock vs physical stock vs variance

Run per tank, per shift.

```
book_opening   = previous shift's book_closing for that tank
refill_litres  = litres received into that tank during the shift
sold_from_tank = Σ net litres sold by every dispenser assigned to that tank
book_closing   = book_opening + refill_litres − sold_from_tank

physical_closing = dip_to_litres(tank, closing_dip_mm)

variance_litres = physical_closing − book_closing
variance_pct    = variance_litres / NULLIF(sold_from_tank, 0) × 100
```

- **Every dispenser is mapped to exactly one tank** (`dispensers.tank_id`). Without that mapping per-tank variance is impossible.
- Variance beyond the configurable threshold (default **±0.5%**) creates an alert and fires the n8n webhook immediately — not at month end.
- The chain must be unbroken: shift N's `book_closing` **is** shift N+1's `book_opening`. Enforce with a database constraint. If a shift is edited, every later shift must be recomputed — build a `recalculate_from(shift_id)` routine for this.

### 4.5 Tanker refill

A road tanker arrives with **4 compartments of 4,500 L each = 18,000 L total**.

Per compartment record: compartment number (1–4), declared/challan litres, destination tank, tank dip **before**, tank dip **after**.

```
received_litres(compartment) = dip_to_litres(tank, dip_after) − dip_to_litres(tank, dip_before)
shortage(compartment)        = declared_litres − received_litres
truck_total_received         = Σ received over all 4 compartments
purchase_value               = received_litres × depot_rate_per_litre
```
- Warn if a compartment would overfill its tank (`physical + incoming > 95% × 12,000`).
- Flag shortage above a configurable tolerance (default 0.3%).
- Record PO number, challan number, truck registration, driver name, depot rate, arrival timestamp.
- On save, the tank's stock increases **live** and is immediately reflected in the current shift's book stock.

### 4.6 Costing and profit

Use **moving weighted average cost per tank** — depot rates change and FIFO is not how the business thinks.

```
new_avg_cost = ((old_stock × old_avg_cost) + (received × depot_rate)) / (old_stock + received)
```

```
diesel_revenue     = net_litres × selling_rate
diesel_cogs        = net_litres × avg_cost_at_time_of_sale
diesel_gross_profit= diesel_revenue − diesel_cogs

lubricant_gross_profit = Σ (sale_amount − qty × purchase_rate) per SKU

gross_profit = diesel_gross_profit + lubricant_gross_profit
net_profit   = gross_profit − total_expenses
```
Expose this aggregated **day / month / year**, and also sliced **per tank**, **per dispenser**, **per product**, and **per credit customer**. Admin and MD only.

### 4.7 Cash reconciliation

```
total_sales     = diesel_sales + lubricant_sales
credit_sales    = Σ party-wise credit sales for the shift
cash_sales      = total_sales − credit_sales

expected_cash   = opening_cash + cash_sales + dues_collected
                  − expenses_paid_cash − bank_deposits
counted_cash    = physical count entered at close
cash_variance   = counted_cash − expected_cash
```
A non-zero `cash_variance` blocks a clean close: the manager must enter a reason before signing off.

### 4.8 Stock cover

```
avg_daily_sale = mean(net_litres) over the last 7 closed days
days_cover     = (tank1_physical + tank2_physical) / NULLIF(avg_daily_sale, 0)
```
Show on every dashboard. Alert below a configurable threshold (default 3 days) so a PO goes out in time.

---

## SECTION 5 — DATA MODEL

Postgres, snake_case, every table with `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`, `created_by uuid references profiles(id)`, and where mutable: `updated_at`, `updated_by`, `deleted_at`, `deleted_by`, `delete_reason`.

**Identity & config**
- `profiles` — id (→ auth.users), full_name, phone, role (`dispenser|manager|admin|md`), is_active, language_pref
- `stations` — name, address, dealer_name, timezone (multi-station ready, single row for now)
- `settings` — key, value jsonb (variance thresholds, shift times, alert targets, n8n URLs)

**Fuel infrastructure**
- `tanks` — code (T1/T2), product, capacity_litres, status (`active|paused|removed`), installed_at
- `tank_calibration` — tank_id, dip_mm int, litres numeric(12,3), version, valid_from, valid_to — **unique (tank_id, version, dip_mm)**
- `tank_metadata` — tank_id, length_mm, diameter_mm, gross_height_mm, final_dip_mm, dip_pipe_length_mm, calibrated_by, calibration_date, validity_from, validity_to, certificate_image_url
- `dispensers` — code (M1–M4), **tank_id**, nozzle_count, meter_digits (default 8), max_flow_lpm, status (`active|paused|removed`)
- `nozzles` — dispenser_id, nozzle_no, product

**Shifts & readings**
- `shifts` — shift_date, shift_type (`day|night`), starts_at, ends_at, status (`open|closing|closed|reopened`), opened_by, closed_by, closed_at
- `meter_readings` — shift_id, nozzle_id, reading_type (`open|close`), reading numeric(12,2), photo_url, ai_extracted jsonb, ai_confidence, confirmed_by, is_rollover
- `tank_dips` — shift_id, tank_id, dip_type (`open|close|pre_refill|post_refill`), dip_mm numeric(8,1), litres numeric(12,3), photo_url, recorded_by
- `shift_sales` — shift_id, gross_litres, test_litres, net_litres, rate_per_litre, sales_amount, cash_sales, credit_sales
- `shift_stock` — shift_id, tank_id, book_opening, refill_litres, sold_from_tank, book_closing, physical_closing, variance_litres, variance_pct, variance_reason

**Purchasing**
- `purchase_orders` — po_number, supplier, order_date, litres, rate, status
- `tanker_deliveries` — po_id, challan_no, truck_reg, driver_name, arrived_at, depot_rate, total_declared, total_received, total_shortage
- `tanker_compartments` — delivery_id, compartment_no (1–4), declared_litres (default 4500), tank_id, dip_before_mm, dip_after_mm, litres_before, litres_after, received_litres, shortage_litres
- `tank_cost_history` — tank_id, effective_at, avg_cost, trigger_delivery_id

**Lubricants / Mobil**
- `lub_skus` — name, brand, pack_type (`loose|can|drum|grease`), pack_size_litres, current_purchase_rate, current_sale_rate, reorder_level, is_active
- `lub_transactions` — sku_id, txn_type (`purchase|sale|own_use|adjustment`), qty, rate, amount, shift_id, customer_id, vehicle_ref, note
  *(`own_use` = oil issued to the station's own lorries — it reduces stock and books as an expense, not a sale.)*
- `lub_stock` — sku_id, qty_on_hand, avg_cost (maintained by trigger)

**Credit / CRM**
- `customers` — name, type (`company|individual|govt`), phone, address, vehicle_numbers text[], opening_balance, credit_limit, is_active, notes
- `credit_sales` — shift_id, customer_id, product (`diesel|lubricant`), litres, rate, amount, vehicle_no, challan_no, slip_photo_url
- `payments` — customer_id, amount, method (`cash|bkash|nagad|bank|cheque|adjustment`), reference, received_at, received_by
- `customer_ledger` — customer_id, entry_date, entry_type (`sale|payment|adjustment|opening`), debit, credit, running_balance, source_id
  *(maintain `running_balance` with a trigger; never recompute on read)*

**Money**
- `expense_categories` — name, name_bn, group (`pump|chairman|staff|maintenance|association|loan|donation|utility|other`), is_active
- `expenses` — shift_id, category_id, amount, description, description_bn, paid_by (`cash|bank|bkash|nagad`), receipt_url, approved_by
- `cash_reconciliation` — shift_id, opening_cash, cash_sales, dues_collected, expenses_cash, bank_deposits, expected_cash, counted_cash, cash_variance, variance_reason
- `bank_transactions` — txn_date, bank_name, account_no, type (`deposit|withdrawal|charge`), amount, reference, slip_url

**Platform**
- `audit_log` — table_name, record_id, action (`insert|update|delete`), before jsonb, after jsonb, actor_id, actor_role, reason, ip, created_at
- `alerts` — type, severity (`info|warn|critical`), title, body, entity_ref, is_read, resolved_at
- `chat_messages` — session_id, user_id, role (`user|assistant`), content, content_lang, audio_url, n8n_request_id, created_at
- `sync_queue` — event_type, payload jsonb, status (`pending|sent|failed`), attempts, last_error, sent_at

**Indexes:** `tank_calibration(tank_id, version, dip_mm)`, `meter_readings(shift_id, nozzle_id)`, `customer_ledger(customer_id, entry_date)`, `shift_stock(tank_id, shift_id)`, `expenses(shift_id)`, `credit_sales(customer_id, shift_id)`.

---

## SECTION 6 — SCREENS

### 6.1 Dispenser app (mobile-only, 3 buttons)
Full-screen, huge tap targets, works one-handed in sunlight, works offline.

- **📷 Take Meter Reading** → camera → capture → upload to Supabase Storage → POST to `/api/ocr/meter` → Claude vision returns `{machine_no, reading, confidence}` → show the photo and the extracted numbers side by side, large → employee taps **Confirm** or edits the reading → save. If offline, queue in IndexedDB and show a "will sync" badge; flush automatically on reconnect.
- **📏 Enter Tank Dip** → pick Tank 1 / Tank 2 → numeric keypad for mm → app instantly shows the converted litres from the calibration chart → optional photo of the dip rod → save.
- **⛽ Refill Dip** → same, tagged pre-refill or post-refill.
- A strip at the bottom: "3 readings submitted this shift ✓".

No money, no totals, no navigation drawer. That is the entire app for this role.

### 6.2 Manager dashboard
- **Top strip:** current shift (Day/Night), time remaining, open/closed badge, litres sold so far, tank levels as two vertical gauge bars with a litres + dip label.
- **Pending approvals** — dispenser submissions awaiting confirmation, with the photo inline.
- **Quick entry tiles:** Credit Sale · Expense · Lubricant Sale · Payment Received · Record Refill.
- **Shift Close wizard** — see 6.6.
- Today's timeline of every event.

### 6.3 Admin dashboard
- **KPI row:** Today's Sales ৳ · Net Profit ৳ · Litres Sold · Cash in Hand ৳ · Dues Outstanding ৳ · Days of Cover.
- **Profit trend** — line chart, toggle Day / Month / Year.
- **Variance panel** — per tank, per shift, last 30 days, with anything past threshold in red.
- **Tank & dispenser control** — cards for each tank and dispenser with **Add / Pause / Remove** actions (admin only), plus current status and last calibration date.
- **Top credit customers** by outstanding balance.
- **Expense breakdown** donut by category.
- Recent audit-log entries.

### 6.4 MD dashboard (read-only, live)
Large-type, glanceable, auto-refreshing via Supabase Realtime. Today's sales, live tank levels, cash position, month-to-date profit, dues outstanding, any open critical alert. A subtle "🟢 Live" pill with the last-updated timestamp. **Zero interactive controls beyond date range and report viewing.**

### 6.5 Stock page
- **Tank stock:** one card per tank — capacity, current dip (mm), current litres, fill percentage as an animated vertical gauge, ullage (empty space), last dip time, avg cost, stock value ৳.
- **Calibration viewer:** open a tank → see its dip→litres chart as both a searchable table and a curve; enter a dip to convert instantly; **Add / Edit** rows (admin only); view the scanned BSTI certificate pages; upload a new chart version on re-calibration.
- **Tanker stock:** tanker deliveries in transit / received, compartment breakdown, shortages.
- Add / Edit buttons throughout, admin-gated.

### 6.6 Shift Close wizard (the most important screen)
A strict linear flow the manager cannot skip:

1. **Meter readings** — every nozzle's closing reading, prefilled from the dispenser's AI-confirmed submission, opening reading shown read-only from the last shift. Live per-nozzle litres.
2. **Test / Assessment** — litres pumped and returned.
3. **Tank dips** — closing dip for both tanks → litres via chart.
4. **Rate** — selling rate per litre for this shift.
5. **Credit sales** — party-wise rows, each with litres, rate, amount, vehicle, challan.
6. **Lubricant / Mobil sales** — loose and can, per SKU.
7. **Expenses** — category, amount, description, paid-by.
8. **Cash** — dues collected, bank deposits, physical cash counted.
9. **Reconciliation summary** — the whole picture on one screen:
   - Gross litres, test, net litres, sales ৳
   - Per tank: book opening → refills → sold → book closing vs physical closing → **variance L and %**, colour-coded
   - Expected cash vs counted cash → **cash variance**
   - Any variance past threshold must be given a written reason before the button enables
10. **Sign off** — manager confirms; shift locks; `book_closing` carries to the next shift; the n8n webhook fires; the daily sheet PDF regenerates.

A closed shift can be **reopened only by admin**, with a reason, and reopening triggers `recalculate_from()` for every later shift.

### 6.7 Tank Refilling page
- **New delivery** form: PO, challan, truck registration, driver, depot rate, arrival time.
- **Four compartment rows** (prefilled 4,500 L each, total 18,000 L): destination tank, dip before → litres, dip after → litres, received, shortage — each computed live as the dips are typed.
- Overfill warning before save.
- Delivery history with per-delivery shortage, cost, and the resulting new average cost.
- **Purchase summary tank-wise** with day / month / year totals and the profit contribution of each delivery.

### 6.8 Cash, Dues & Expenses
- **Cash:** daily cash book, opening → sales → collections → expenses → deposits → closing, with variance history.
- **Dues (CRM):** customer list with outstanding balance, credit limit and a utilisation bar; over-limit customers flagged red. Customer detail = full running ledger, transaction history, ageing buckets (0–30 / 31–60 / 61–90 / 90+), record-payment action, and a one-tap WhatsApp reminder via n8n.
- **Expenses:** entry form with category autocomplete, receipt photo, month view grouped by category, and separate **Pump** vs **Chairman** expense books as the paper sheet does.

### 6.9 Mobil & Lubricants (buy / sale / own-use)
- SKU list with stock on hand, purchase rate, sale rate, margin, reorder flag.
- **Buy** — record purchase, updates stock and average cost.
- **Sale** — loose (by litre) or can (by pack), cash or to a credit customer.
- **Own use** — oil issued to the station's own lorries: reduces stock, books to an expense category, never counts as revenue.
- Per-SKU movement ledger and a low-stock alert list.

### 6.10 Reports
Every report filterable by date range and exportable to **Excel and PDF**, in Bangla or English:
- **Daily Sheet** — a faithful digital replica of the existing paper form, including all five signature lines.
- Shift reconciliation report
- Tank stock & variance register
- Purchase register (tank-wise, PO-wise)
- Sales register (cash / credit / product)
- Customer ledger & ageing
- Expense register (pump / chairman / category)
- Cash book & bank book
- Profit & Loss — day / month / year
- Dispenser performance
- Lubricant movement
- Audit log

### 6.11 Chat assistant (on every dashboard)
A floating glass panel, bottom-right on desktop, full-screen sheet on mobile.

- Text input **and** a microphone button.
- **Bangla voice input is a first-class requirement.** Use the Web Speech API with `lang="bn-BD"`, and fall back to recording the audio and POSTing it to n8n for server-side transcription when the browser has no Bangla support (most Android browsers in Bangladesh do; Safari does not).
- Every message POSTs to `NEXT_PUBLIC_N8N_CHAT_WEBHOOK` with `{session_id, user_id, role, message, lang, audio_url?}` and renders the reply.
- The assistant answers from live data — "Shah Mamun truck er baki koto ekhon?", "aajke tank 2 e variance koto?", "ei mash e profit koto?" — and can log an expense or a credit sale by voice, always showing a confirmation card the user must tap before anything is written.
- Persist every turn in `chat_messages`. Show a typing indicator. Handle n8n being down gracefully.

---

## SECTION 7 — DESIGN

**Minimalist, professional, glassmorphic — panels that appear to hover above the background.**

```css
--glass-bg:     rgba(255,255,255,0.72);
--glass-border: rgba(255,255,255,0.45);
--glass-blur:   backdrop-filter: blur(16px) saturate(180%);
--glass-shadow: 0 8px 32px rgba(15,23,42,0.10), 0 2px 8px rgba(15,23,42,0.06);
--radius:       16px;
```

- Cards: translucent white, 1px light border, soft layered shadow, `backdrop-blur`. On a subtle gradient page background (slate-50 → blue-50) so the blur has something to work with. Dark mode inverts to `rgba(15,23,42,0.72)`.
- Lift on hover: `translateY(-2px)` + deeper shadow, 200ms ease.
- **Colour:** near-monochrome slate base. One accent (deep blue `#1e40af`). Semantic only: green = within tolerance, amber = watch, red = past threshold. Never decorate with colour.
- **Typography:** `Inter` for Latin and numerals, `Noto Sans Bengali` for Bangla. Tabular figures (`font-variant-numeric: tabular-nums`) everywhere a number appears in a column.
- **Numbers:** BDT with the Bangladeshi lakh/crore grouping (৳১২,৩৪,৫৬৭.৮৯). Litres to 3 decimals. A language toggle switches both labels and numerals (Bangla numerals when Bangla is selected).
- **Density:** generous on mobile (min 44px tap targets), compact tables on desktop. Never a horizontal scrollbar on a phone — tables collapse to stacked cards below 640px.
- **States:** design the empty, loading (skeletons, not spinners), error and offline state of every screen. Offline shows a persistent amber bar with the queued-item count.
- Respect `prefers-reduced-motion`.

---

## SECTION 8 — n8n INTEGRATION

**Outbound.** After every committed transaction, insert into `sync_queue` and POST to `N8N_EVENT_WEBHOOK`:
`shift.closed`, `meter.recorded`, `dip.recorded`, `refill.received`, `credit_sale.created`, `payment.received`, `expense.created`, `variance.exceeded`, `stock.low`, `credit_limit.exceeded`.

Payload: `{event, occurred_at, station_id, actor, data:{...}, idempotency_key}`.
Retry with exponential backoff, 5 attempts, then mark `failed` and raise an alert. **A failed sync must never block or roll back the local write** — the app is the system of record, Google Sheets is the mirror.

**Inbound.** Two authenticated routes, protected by a shared secret header:
- `POST /api/n8n/chat` — chat replies routed back to the right session.
- `POST /api/n8n/command` — lets an n8n flow write a record (e.g. an expense logged from WhatsApp), subject to the same validation and RLS as the UI.

Ship `docs/n8n-setup.md` documenting every payload, plus a ready-to-import n8n workflow JSON that appends each event to the matching Google Sheets tab.

---

## SECTION 9 — NON-NEGOTIABLES

- **Audit everything.** A Postgres trigger writes to `audit_log` on every insert/update/delete of a financial table. Deletes are soft. Edits require a reason. The audit log is append-only and not deletable by anyone, including admin.
- **Offline-first for the dispenser.** Meter photos and dips queue locally and sync on reconnect. Nothing is lost if the forecourt loses signal.
- **Idempotency.** Every mutating API route accepts an `Idempotency-Key`. A double-tap must never create two records.
- **Timezone.** All timestamps `timestamptz`; all business logic in `Asia/Dhaka`. A "day" runs 06:00 → 06:00, not midnight → midnight — the night shift spans two calendar dates and must be attributed to its opening date.
- **Seed data.** Seed the two calibration charts, 2 tanks, 4 dispensers, the 17 expense categories, the ~21 known credit customers, and one user per role.
- **Tests.** Vitest unit tests for every function in `lib/calc/` — meter rollover, dip interpolation, variance, weighted average cost, cash reconciliation, shift-chain continuity. These are the tests that matter; do not skip them.
- **Documentation.** `README.md` (setup, env vars, deploy), `docs/calculations.md` (every formula with a worked example), `docs/n8n-setup.md`, `docs/roles.md`.

---

## SECTION 10 — BUILD PHASES

Work through these **one at a time**. Finish, test and confirm each phase before starting the next.

**Phase 1 — Foundation**
Next.js + TypeScript + Tailwind + shadcn/ui scaffold. Supabase project, full schema migration, RLS policies for all four roles, audit triggers. Auth with role-based routing. Glassmorphic design system and shared layout. Bangla/English i18n scaffold. Seed script including both calibration charts.
*Done when:* each of the four roles logs in and lands on its own empty dashboard, and RLS is proven with a test that a `dispenser` cannot select from `expenses`.

**Phase 2 — Calibration & tank core**
`tank_calibration` loaded and indexed. `dipToLitres()` and `litresToDip()` with interpolation and version awareness, unit-tested. Stock page with tank cards, gauges and the calibration viewer. Admin add/pause/remove for tanks and dispensers.
*Done when:* entering 1450 mm returns the certified litres for both tanks; a dip of 2071 mm is rejected for Tank 1; a dip of 2052 mm is rejected for Tank 2; and 2070/2051 mm return exactly 12,000 L.

**Phase 3 — Dispenser app & AI meter OCR**
The three-button mobile screen. Camera capture, Supabase Storage upload, `/api/ocr/meter` calling Claude vision, the confirm screen, offline IndexedDB queue and sync. Dip entry with live litres conversion.
*Done when:* a photographed meter is read, confirmed and saved — and the same works with the phone in airplane mode, syncing on reconnect.

**Phase 4 — Shifts & reconciliation**
Shift lifecycle. Meter rollover handling. The 10-step Shift Close wizard. Book vs physical stock, variance computation, threshold alerts. The `book_closing → book_opening` chain with its constraint, plus `recalculate_from()`.
*Done when:* two consecutive shifts close, the stock chain is unbroken, and an injected 1% discrepancy raises a variance alert that blocks sign-off until a reason is given.

**Phase 5 — Purchasing & refills**
Tanker delivery form with the 4×4,500 L compartments, per-compartment dip-based receipt, shortage detection, overfill warning. Moving weighted average cost. Purchase register tank-wise with day/month/year.
*Done when:* an 18,000 L delivery split across both tanks updates stock, shortage and average cost correctly.

**Phase 6 — Money, CRM & lubricants**
Credit customers with limits, `customer_ledger` with trigger-maintained running balance, ageing, payments. Expenses with pump/chairman books. Cash reconciliation. The Mobil/lubricant module with buy, sale and own-use.
*Done when:* a credit sale, a part payment and an over-limit block all behave correctly and the ledger balance is right.

**Phase 7 — Dashboards & reports**
All four role dashboards. MD realtime read-only view. The full report set with Excel and PDF export, including the faithful Daily Sheet replica. Profit & Loss day/month/year.
*Done when:* the generated Daily Sheet matches the paper form field for field.

**Phase 8 — Chat & n8n**
The glass chat panel, Bangla voice input with fallback, `chat_messages` persistence, the outbound event queue with retry, the two inbound routes, and `docs/n8n-setup.md` with the importable workflow.
*Done when:* a Bangla voice question returns a correct answer from live data, and a closed shift lands in Google Sheets.

**Phase 9 — Hardening**
PWA manifest, service worker, install prompt. Full test suite green. Performance pass. Accessibility pass. All four docs written. Vercel deploy with env vars documented.

---

## SECTION 11 — ASK BEFORE ASSUMING

If any of these is unclear when you reach it, stop and ask rather than guessing:
- whether a dispenser has one or two nozzles, and the exact totalizer digit count
- the real variance tolerance the business accepts
- whether lubricant own-use should hit a specific expense category
- the opening balances for the credit customers at go-live

Build Phase 1 now.
