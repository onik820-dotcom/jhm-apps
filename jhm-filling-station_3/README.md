# M/S. J.H.M. Filling Station

Shift, stock and accounts system for a Padma Oil dealer on the Jashore–Khulna
highway at Chengutia, Abhaynagar, Jashore.

Two 12,000 L underground tanks, four dispensers, two shifts a day, ~21 credit
parties. It replaces a paper sheet and four Excel workbooks, and the money and
stock are reconciled against it every twelve hours.

**Three rules the code is written to.**

1. Nothing is lost or silently changed. Every write is audited; edits and
   deletes are soft and leave the original figure in place.
2. Money is `NUMERIC(14,2)`, volume is `NUMERIC(12,3)`, and no calculation
   anywhere uses a JavaScript float. `decimal.js` on the client, `NUMERIC` in
   Postgres.
3. A shift close either balances or is explicitly flagged. A variance is
   recorded with a written reason — it is never rounded away.

---

## Build status

The build runs in nine phases (Section 10 of the master prompt).

| Phase | Status |
|---|---|
| 1 — Foundation: schema, RLS, audit, auth, design system, i18n, seed | **Done, applied to the live database** |
| 2 — Calibration and tank core | **Done, verified in the live UI** |
| 3 — Dispenser app and AI meter OCR | **Done**, except the live vision call, which needs an `ANTHROPIC_API_KEY` |
| 4 — Shifts and reconciliation | **Done, verified end to end in the live UI** |
| 5 — Purchasing and refills | **Done, verified end to end in the live UI** |
| 6 — Money, CRM and lubricants | **Done, verified as the real signed-in roles** |
| 7 — Dashboards and reports | **Done**, except the Daily Sheet captions, which need checking against the paper form |
| 8 — Chat and n8n | **Built and boundaries proven**; the model call and the live n8n round trip need keys |
| 9 — Hardening, PWA, deploy | **Done** — installable, contrast fixed, bundle trimmed, four docs current |

`lib/calc/` is complete and tested ahead of its screens on purpose: it is the
part the business reconciles against, so it is the part worth getting right and
proving first.

### Phase 1 acceptance

Both criteria are met against the live database.

**Each role signs in and lands on its own dashboard.** Verified in a browser
against `JHM apps`:

| Role | Lands on | What it sees |
|---|---|---|
| dispenser | `/dispenser` | Three buttons and a submission count. No ৳ appears anywhere on the page. |
| manager | `/manager` | Shift strip, tank gauges, quick-entry tiles, pending approvals |
| admin | `/admin` | KPI row, tank and dispenser cards with Add / Pause / Remove, audit log |
| md | `/md` | Live pill, KPIs, tank levels — and exactly two buttons on the page, language and sign out |

Route guards hold too: a dispenser opening `/admin` is returned to
`/dispenser?denied=/admin`, and an MD opening `/admin` or `/expenses` is
returned to `/md`.

**A dispenser cannot select from `expenses`.** `npm run verify:rls` proves it by
signing in as each role. With a fixture row present in every table under test,
all 18 checks passed conclusively, including `0 of 1 existing rows returned` for
the expenses check and `0 of 4,197` for the audit log. The fixtures were then
removed.

On a database with no trading data yet, seven of those checks report **unproven**
rather than passing: an empty table returns nothing to everybody, so hiding it
demonstrates nothing. The script says so instead of showing a green tick, and
still exits zero because nothing failed. They become conclusive from the first
closed shift onward.

### Phase 2 acceptance

All four criteria verified by typing into the dip converter on `/stock`, which
converts through the database function rather than the TypeScript mirror — so
what it shows is exactly what a shift close will record.

| Entered | Tank 1 | Tank 2 |
|---|---|---|
| 1450 mm | 8,455.000 L, exact certified row | 8,679.000 L, exact certified row |
| Its own final dip | 2070 mm → 12,000.000 L | 2051 mm → 12,000.000 L |
| One past it | 2071 mm rejected | 2052 mm rejected |
| 2070 mm | 12,000.000 L | **rejected** — 2070 is not a global maximum |
| 1450.5 mm | 8,458.500 L, flagged as interpolated | — |

The stock page carries a card per tank with a vertical gauge, dip, litres, fill
percentage, ullage and — for admin and MD only — average cost and stock value.
Opening a tank shows its BSTI metadata and the certified chart as both a
searchable table and a curve. The table's per-millimetre step column is worth a
look: about 7 L mid-tank, dropping to 3–4 L near the top where the dished end
narrows. That is the shape a cylinder formula would get wrong.

Admin gets Add / Pause / Remove for tanks and dispensers, and can correct a
calibration row. Both paths refuse the dangerous cases:

- a calibration edit that would break the chart's strict increase is rejected,
  naming the neighbouring row it collides with
- a tank that is not empty, or that still has dispensers on it, cannot be removed
- removal always demands a written reason, and it is a soft delete

Every one of those changes is recorded in `audit_log` with the actor, their role
and the before and after images — confirmed by pausing and resuming a dispenser
and reading the trail back.

A manager opening the same page sees the tank cards, the charts and the
converter, but no cost figures and no controls: the page renders exactly two
buttons, language and sign out.

### Phase 3 acceptance

**A photographed meter is read, confirmed and saved.** Verified end to end: a
photo was taken through the camera input, downscaled from 2400×1600 to 1568 px
on the long edge, sent to `/api/ocr/meter`, confirmed on the review screen and
written to `meter_readings` — attached to the open shift and the right nozzle,
with the photo in the `meter-photos` bucket, `recorded_by` set to the dispenser
and a `client_ref` for idempotency.

**The same works with the phone offline, and syncs on reconnect.** With
`navigator.onLine` forced false and `fetch` rejecting — the two things the app
actually reads — a dip of 1450 mm still converted to 8,455.000 L from the chart
cached on the device, saved to IndexedDB, and showed *"saved on this phone —
will sync"*. The database held zero dip rows throughout. On reconnect the queue
drained by itself and the row appeared with **8,455.000 L computed by the
database trigger**, stamped with chart version 1 and the original capture time.

**One thing the vision call still needs.** There is no `ANTHROPIC_API_KEY` in
`.env.local`, so the live Claude call has not been exercised. Everything around
it has: the route authenticates, refuses an unauthenticated caller with a 401,
and returns a clean `NO_API_KEY` when the key is absent — at which point the
capture screen falls back to *"type it in"*, which is the same path the employee
takes with no signal. Set the key to turn the reading on; nothing else changes.

### Phase 4 acceptance

All four criteria met by driving the wizard in a browser against the live
database, then reading the result back in SQL.

**Two consecutive shifts closed.** A day shift opened at T1 8,455 L / T2 7,607 L,
sold 2,000 L gross with 5 L into the test measure, and closed at ৳2,17,455.
A night shift followed it.

**The stock chain is unbroken.** Per tank, every closing is the next opening:

| Tank | Day open → close | Night open → close |
|---|---|---|
| T1 | 8,455.000 → 7,460.000 | 7,460.000 → 6,460.000 |
| T2 | 7,607.000 → 6,607.000 | 6,607.000 → 5,607.000 |

Checked in SQL with a window function over every link, not by eye.

**An injected 1% discrepancy blocked sign-off.** The night shift's T1 dip was
set 10 L short of its book. The summary flagged it at −9.600 L (−0.96%) against
the ±0.5% threshold, the sign-off button was disabled, clicking it did nothing,
and the wizard said so in Bangla. Entering a reason enabled the button and the
shift closed — with the reason stored on `shift_stock`, a `critical` alert
raised, and `shift.closed` and `variance.exceeded` queued for n8n.

The block is not only in the UI. `close_shift()` refuses the same case itself:
*"Tank T1 is out by −9.600 L, −0.9600 percent of what it sold. Write why before
signing off."* Proven separately in SQL, so removing the UI guard would change
nothing.

**Reopen and recalculate work.** Reopening is admin-only and refuses an empty
reason. After reopening the day shift and correcting it by 40 L,
`recalculate_from()` moved the night shift's opening from 7,460 to 7,420 L and
the chain was whole again.

### Phase 5 acceptance

**An 18,000 L delivery split across both tanks updates stock, shortage and
average cost correctly.** Entered through the form on `/refill` and read back
in SQL:

| | Declared | Received | Shortage |
|---|---|---|---|
| Compartment 1 → T1 | 4,500 | 4,498.000 | 2.000 |
| Compartment 2 → T1 | 4,500 | 4,460.000 | **40.000 — flagged** |
| Compartment 3 → T2 | 4,500 | 4,500.000 | 0.000 |
| Compartment 4 → T2 | 4,500 | 4,499.000 | 1.000 |
| **Total** | **18,000** | **17,957.000** | **43.000 (0.24%)** |

Stock moved to the figures the rods measured — T1 739 → 9,697 L, T2 907 →
9,906 L — and the purchase was valued at ৳18,76,506.50, on litres received
rather than litres declared. Compartment 2 was flagged at 0.89% against the
0.3% tolerance while the delivery as a whole stayed under it, which is the
point of checking both.

A second delivery into T1 at a higher rate blended as documented:
`((9,697 × 104.50) + (997 × 106.00)) / 10,694 = ৳104.6398`, checked against the
formula by hand rather than against the code that produced it.

### Two things testing caught in the costing

**The manager's own RLS was breaking the moving average.** A manager records
deliveries but may not see blended cost, so `tank_cost_history` is hidden from
them — which meant the costing read back nothing, every tank looked brand new,
and each delivery re-based the whole tank at that day's rate instead of
blending. Silently, and only for the role that does the recording. The
calculation now runs as the definer so it can always read the previous cost,
while the answer is only returned to a caller allowed to see cost. The helper
that writes the new average returns nothing at all, so the figure never travels
back to a manager who could otherwise read it out of a contrived call.

**A tank's opening stock has never been valued.** At go-live each tank holds
fuel with no cost history, and blending those litres in at zero would understate
the cost of everything sold afterwards. The first delivery therefore prices the
whole tank at that day's depot rate and labels it *first valuation* rather than
presenting it as an ordinary average. Setting a real opening valuation is on the
go-live list below.

### Phase 6 acceptance

**A credit sale, a part payment and an over-limit block all behave correctly
and the ledger balance is right.** Fourteen checks, run through the anon key as
the seeded manager and the seeded admin so RLS is in force throughout —
`npx tsx scripts/verify-phase6.ts`. A party opened with a ৳50,000 limit and
৳10,000 already owed, dated 120 days back:

| | Result |
|---|---|
| Credit sale ৳25,000 | balance ৳35,000 |
| Part payment ৳15,000 in cash | balance ৳20,000 |
| Sale of ৳40,000 by a manager | **refused** — would reach ৳60,000, past the ৳50,000 limit |
| The refused sale | left the balance at ৳20,000 |
| Sale of ৳30,000, landing exactly on the limit | allowed |
| One taka past the limit | refused |
| Sale against inactive "Credit Party 07" | refused |
| Manager approving their own override | refused |
| Owner approving with no written reason | refused |
| Owner approving with a reason | allowed, balance ৳60,000, alert raised |
| Ageing | the ৳15,000 payment cleared the 120-day opening first: 0–30 ৳60,000, 90+ ৳0 |
| Manager adjusting a balance | refused — owner only |
| 2 L of oil to a station lorry | shelf 10 → 8 L, ৳1,000 booked to the Pump book at cost |
| 100 L off a shelf holding 8 | refused |
| ৳15,000 cash + ৳4,000 bKash collected | drawer counts ৳15,000; the bKash is kept out of it |

The four screens were then rendered against the running server with a real
session cookie (`npx tsx scripts/render-check.ts`), which checks that each page
returns 200 for a manager, renders its own content rather than a crash screen,
prints the party's balance as the page's own formatter would, and shows the
average-cost column to the owner and to nobody else.

### The bug that would have lost money quietly

Proving the acceptance criteria turned up a defect in the ledger that had been
there since Phase 1. Five credit sales of ৳1,000 to one party, posted in a
single transaction, left the party owing **৳2,000**:

```
debit 1000.00  running_balance 3000.00
debit 1000.00  running_balance 3000.00
debit 1000.00  running_balance 2000.00
debit 1000.00  running_balance 1000.00
debit 1000.00  running_balance 2000.00
```

৳3,000 gone, with every document still on file and nothing to show anything had
happened. The running-balance trigger found the previous entry with
`order by entry_at desc, id desc`, and `now()` does not advance inside a
transaction — so every row carried the same timestamp and the tie fell to a
random UUID. Each insert read whichever earlier row happened to sort highest
rather than the one actually before it.

This was not a corner case. `close_shift()` stamps every credit sale in a close
with the shift's end time, so any shift with more than one credit sale to the
same party hit it. `customer_ledger` now carries an `entry_seq`, assigned by
the database in insertion order, and the balance chains on that — a clock was
never an ordering. Migration `0021` has the detail.

### Two figures the shift close was asking the manager to type

The cash reconciliation worked, but two of its five inputs were entered by the
person being reconciled.

**Opening cash.** The drawer is not emptied between shifts, so what it opens
with is what the last shift counted. Typing it meant a shortage could be
carried forward by adjusting the opening figure until it disappeared. The stock
chain has been enforced since Phase 4; the cash chain was not. It now chains
from the previous count and the field is shown read-only, enterable only on the
very first close when there is no count to chain from.

**Dues collected.** Typed, and tied to no customer — ৳10,000 of "dues" could
balance the drawer without any party's ledger moving. It is now summed from the
payment rows recorded during the shift, and only the ones taken in cash: a
bKash collection reduces what a party owes but never reaches the till, and
counting it as if it had manufactured a shortage.

### Own use had nowhere to book

`lub_transactions.txn_type` has carried a comment since Phase 1 saying own use
"books as an expense, and is never counted as revenue". Nothing did. Oil went
into the station's own lorries, the shelf dropped, and the cost landed nowhere.
It now leaves at the moving average on the shelf — never at the sale rate,
which would invent a margin on oil nobody paid for — and books to the Lubricant
Own Use head. The shelf also refuses to go below empty.

### PostgREST returns every numeric as a float

The data layers declared money fields as `string`, on the basis that Postgres
`numeric` arrives from PostgREST as a string. It does not. Every numeric comes
back as a JSON number — table selects, set-returning functions and values
inside a `jsonb` result alike — so those fields were doubles with a `string`
type on them.

No money has been lost to it: a double round-trips through its shortest decimal
representation and decimal.js rebuilds from exactly that, so ৳18,76,506.55
survives intact at every figure this station will ever see. What a double
cannot survive is *arithmetic*, and a type that says `string` invites exactly
that. `lib/data/numeric.ts` now converts at the boundary, so below it the
figures really are fixed-point strings; `lib/data/numeric.test.ts` holds it
there. The Phase 6 data layers go through it. **The Phase 3–5 layers
(`overview.ts`, `stock.ts`, `refill.ts`, `shift-close.ts`, `dispenser.ts`) have
not been converted** — their displayed figures are correct for the same reason,
but their types carry the same lie and they are worth a pass before go-live.

### Phase 7 acceptance

**The generated Daily Sheet matches the paper form field for field.** This one
cannot be self-certified, and saying so is more useful than a green tick.

The brief describes the Daily Sheet as "a faithful digital replica of the
existing paper form, including all five signature lines". That sentence is the
only written description of the form anywhere in the project, and the form
itself has not been seen. **Five signature lines is a fact; which five, and the
order of the sections above them, is not.**

So the sheet is built in two parts. Every *figure* is computed from the closed
shifts and is certain — `npm run check:reports` proves each section has its
rows and that what the page prints equals what the database holds:

| Section | Rows | |
|---|---|---|
| Meter readings | 8 | opening from the previous close, per nozzle |
| Tank stock | 4 | book against the rod, with the variance and its reason |
| Tanker receipts | 1 | challan, truck, declared, received, shortage |
| Credit sales | 3 | party-wise with vehicle and challan |
| Lubricants | 2 | sale and own use, kept apart |
| Expenses | 5 | Pump and Chairman books side by side, never summed together |
| Cash account | 2 | opening → sales → collected → expenses → deposits → counted |

and the sheet balances on its own face: cash ৳8,45,752.50 + credit ৳54,718.75
= total ৳9,00,471.25.

Every *caption* — all nine headings and all five signature lines, in both
languages — lives in `settings.daily_sheet_labels`. Correcting the sheet
against the real form is an admin edit to one JSON row: not a migration, not a
deploy, not a conversation with a developer. Until somebody sets `confirmed`,
the sheet prints a line on its own face saying the captions have not been
checked. The seeded five follow the usual order of responsibility at a
dealership — the person who pumped, the person who ran the shift, the person
who counted, the person who keeps the books, the owner.

**Send a photo of the paper form and this becomes a five-minute job.**

Everything else in the phase is done and proven. Twelve reports, each rendering
for the roles allowed it: a manager opening Profit & Loss gets a report they
may see rather than an error, and the export route answers them `403`. Excel
comes out as a real `.xlsx` with money as numbers under a `#,##0.00` format, so
the accountant can select a column and get a sum.

### Why the PDF is the browser's own print

There is no PDF library here, and that is deliberate. Bengali needs complex
text shaping — conjuncts, reordered vowel signs, ligatures — and JavaScript PDF
generators largely do not shape text: they lay out Bangla glyph by glyph and
produce something a reader would call broken. The browser shapes it correctly
because it is the same engine that renders the screen. So the PDF button is
`window.print()` against an A4 print stylesheet, and the Bangla on paper is the
Bangla on screen.

### Profit, and two decisions inside it

`profit_and_loss()` costs fuel shift by shift at the blended average in force
when that shift closed, rather than at today's average — which would be wrong
in both directions, overstating profit in a falling market and understating it
in a rising one. On the seeded day it reconciles exactly to hand arithmetic,
including a fuel margin of ৳3.85 a litre falling out of ৳106.25 − ৳102.40.

Two lines on it are judgements, and both are stated on the report itself:

- **The Chairman book sits below the operating result, not inside it.** Money
  the owner draws is a distribution, not a cost of selling diesel; folding it
  in would make the pump look unprofitable in a month the owner took more out.
- **Own-use lubricant is inside pump expenses, at cost.** It is a real cost and
  never a sale.

Where a figure is an estimate the report says so: litres sold out of stock that
was never valued are held out of the cost entirely and reported as a gap, and
lubricant cost of sale is flagged as an estimate because the shelf keeps no
historical cost.

### Three more defects the reports found

Building a day of trading to report on turned up three bugs in code that had
already passed its own phase.

**Night-shift rows were landing on the next day.** `close_shift()` stamps what
it writes with the shift's `ends_at`. For a day shift that is 18:00, safely
inside the business day; for a night shift it is 06:00 the following morning,
which is not near the boundary — it *is* the boundary. Every night shift's
expenses, credit sales and lubricant movements were dated to the following day.
The seeded P&L came back ৳15,400 light, and the missing money was both of the
night's expenses including the whole Chairman book. Timestamps are now clamped
inside their shift by trigger, so every insert path is covered, and reports
date a row by its shift when it has one. Migration `0027`.

**Oil sold on the Lubricants screen never reached the drawer.** Phase 6 gave
lubricants their own screen; the close, written in Phase 4, counted only what
was typed into its own lubricant step. The seeded night shift sold ৳7,440 of
engine oil and reconciled against a figure that did not include it — the money
went in the till and the night came out with a surplus somebody had to explain,
or did not. Now summed from the movement rows. The same shape as the dues bug
in Phase 6, and the same fix: stop asking what was typed, count what was
recorded. While fixing it, a second gap: oil sold to a credit party reduced the
shelf and billed nobody, because `credit_sales` carries fuel and nothing posted
`lub_transactions` to a ledger. Migration `0026`.

**The calibration curve was drawing half a tank.** `getCalibrationCurve` asked
for the whole chart in one select. PostgREST caps a response at 1,000 rows and
a chart is 2,070, so it did not fail — it quietly returned the first 1,000 and
drew a curve that stopped at 1000 mm / 5,163 L, labelled as the top of a
12,000 L tank. Phase 2's acceptance tested the dip *converter*, which goes
through the database, so this sat behind a passing test since Phase 2. The rows
are paged now, the way `lib/offline/charts.ts` already did.

### Phase 8 acceptance

Two criteria, and neither can be fully signed off yet — both need a key this
project does not have. What *can* be proven is proven, and the gap is named
rather than papered over. `npm run check:chat`.

**A Bangla voice question returns a correct answer from live data.** Everything
around the model works: the panel, `bn-BD` speech recognition with a recorded
fallback, persistence, and the tools the model answers from. Asked
*"aajke koto bikri holo?"* with no `OPENAI_API_KEY` set, the route degrades to
a plain sentence saying so rather than erroring, and the question is still
written to `chat_messages`. **The model call itself is unproven** — set
`OPENAI_API_KEY` and it runs.

**A shift closed by chat lands in Google Sheets.** The queue fills correctly —
the demo day left seven events waiting — and the retry chain is verified end to
end. **The round trip to a live n8n is unproven** because none is wired; set
`N8N_EVENT_WEBHOOK` and import [docs/n8n-workflow.json](docs/n8n-workflow.json).

One deliberate refusal: **closing a shift by chat command does not close the
shift.** Closing needs meter readings and dips read off machines on the
forecourt, and the chat has no way to collect them. A spoken "close the shift"
produces a card that takes you to the wizard. This would otherwise be the one
place in the system where a figure appeared without somebody reading it off a
machine, and that is not a corner worth cutting for a nicer demo.

### The two decisions that make a chat safe in an accounts system

**The assistant has no privileges of its own.** Every read runs on the asker's
own Supabase session, so RLS answers exactly as it would if they had opened the
screen:

| | manager | admin |
|---|---|---|
| Asks for profit | refused — *"Profit is shown to the owner and the MD only"* | ৳24,859.25 |
| KPI tool | `month_profit` absent entirely | present |
| What a party owes | ৳67,625 | ৳67,625 |
| A dispenser asks anything | refused — *"These figures are not open to your role"* | |

Prompting a model not to reveal something is a wish. Letting the database
refuse is a rule.

**The assistant cannot write.** There is no mutating tool. A spoken *"log 500
taka for tiffin"* resolves to a **proposal** — a card listing every field — and
nothing is saved until a person taps it. The confirmation then goes through the
same server action the form uses, with the same validation, triggers, RLS and
audit row. The model's output is never the write.

The retry chain on the outbound mirror, verified by walking a synthetic event
to its limit: backoff 2 → 4 → 8 → 16 minutes, marked `failed` after five
attempts, and a **critical alert raised** rather than a row going quiet. A
backed-off row is skipped until due; a row given up on is never retried. A
failed sync never touches the local record — the shift stayed closed.

### Two AI providers, and why

The brief's Section 2 locks Anthropic, and the Phase 8 brief asked for OpenAI.
Asked which should win, the answer was OpenAI, so **Anthropic reads the meter
photos and OpenAI runs the chat**. Both keys are server-side only and neither
reaches the browser.

One deviation from Section 6.11 worth flagging: voice that the browser cannot
transcribe goes to `/api/chat/transcribe` rather than to n8n. The recording is
an employee's voice inside a financial system, and that route already holds an
OpenAI key server-side — keeping the audio in our own trust boundary is tighter
than forwarding it to a webhook. Set `N8N_TRANSCRIBE_WEBHOOK` and it forwards
instead.

### Phase 9 acceptance

**Installable.** A manifest, icons drawn from JSX rather than stored as binary
assets, an iOS icon, two home-screen shortcuts straight to the meter and dip
screens, and an install prompt that stays down for a month once it is turned
away. `npm run build` is clean.

**Full test suite green.** 123 tests, typecheck, lint, and five live checks.

**Performance pass.** `/stock/[tankId]` was **255 kB** first-load — Recharts,
loaded on every visit to render a curve that sits behind a tab nobody opens by
default. Moved behind `next/dynamic`, it is **153 kB**, a 102 kB saving with no
change in behaviour. The remaining heavy routes are `/login`, `/md` and
`/dispenser/*` at 187–219 kB, and that weight is the browser Supabase client,
which each of them genuinely needs — sign-in, Realtime, and Storage uploads
respectively. Everything else sits at 144–157 kB over a 102 kB shared baseline.

**Accessibility pass.** `npm run check:a11y` — and it found real faults:

| | Was | Now |
|---|---|---|
| `--text-faint`, light mode | #94a3b8 at **2.49:1** | #64748b at 4.63:1 |
| `--color-breach`, dark mode | #b91c1c at **2.71:1** | #f87171 at 6.35:1 |
| `--color-ok`, dark mode | 3.50:1 | 10.08:1 |
| `--color-watch`, dark mode | 3.50:1 | 10.52:1 |
| `--text-faint`, dark mode | 3.69:1 | 6.85:1 |

The first one carried every hint, table heading and secondary label in the app.
The second was the **variance and alert colour** — the one figure on a page
somebody has to be able to read. This app is used in sunlight on a forecourt,
which makes "decorative grey" the wrong call twice over.

Also fixed: the chat's message box had no accessible name.

**Four docs current.** `README.md`, `docs/calculations.md` (extended through
Phase 9 — the rod floor, three books, ledger ordering, credit limits, ageing,
each with a worked example), `docs/n8n-setup.md`, `docs/roles.md` (extended
with the assistant's boundary table and the report matrix).

### The checker that was agreeing with itself

The accessibility script's first version reported a clean pass on the button
check. It was wrong, and the way it was wrong is worth recording.

It found buttons with `/<button\b([^>]*)>/`. Nearly every button here carries an
inline handler — `onClick={() => setOpen(true)}` — and `[^>]*` stops dead at the
`>` inside `=>`. Attributes came back truncated, so an `aria-label` written
after the handler was invisible, and the body started mid-attribute, which
reads as text, so the button was taken for a named one and never checked.

A false pass, which is the worst kind of bug a checker can have. It was found
by feeding it a deliberately broken button and watching it say nothing.

Fixing the parser surfaced seven more, of which several were false positives of
the opposite kind — `{periodLabels[key]}` read as empty, and
`<span>{t('auth.signOut')}</span>` stripped along with its text. Both
directions are now tested: the script is run against an injected fault each
time, and it has to catch it before its clean run means anything.

### The PWA that would have silently not worked

Everything above was written, typechecked, linted and built clean — and the
whole thing was broken, because the middleware was redirecting three of its six
endpoints to the login page:

```
/manifest.webmanifest    200   ✓
/icons/192, /icons/512   200   ✓
/sw.js                   307   → the worker never registers
/offline                 307   → the fallback is a redirect to a page you also cannot reach
/apple-icon              307   → no iOS home-screen icon
```

The manifest and icons were already in the matcher's exclusion list from
Phase 1; the three new paths were not. Nothing failed, nothing logged, and the
build was green. It was found by asking for the six URLs and reading the status
codes, which took one command and is the only thing that would have caught it.

`/offline` is now a public path — it has to be reachable by somebody with no
network, and it carries no figures — and `sw.js` and `apple-icon` are excluded
from the middleware entirely. A money page still answers `307`.

### Why the PWA has no plugin

The locked stack names `next-pwa`. It was last published in **August 2022**,
declares `next >= 9`, and predates the App Router this app is built on.

The deeper reason is what those plugins generate. The default Workbox runtime
caching serves pages and API responses cache-first or stale-while-revalidate,
so a weak signal quietly produces a page that looks fine and is out of date. In
this app that means a manager opens Dues on one bar and reads yesterday's
balance as today's. Every screen here is a server component rendering live
money: **caching the HTML is caching the numbers.**

So the worker is ~130 lines and hand-written, and its rule is narrow:

| | |
|---|---|
| Cached | content-hashed build output, and one offline notice |
| **Never cached** | any HTML document, any `/api` route, anything from Supabase |

Offline, those fail — and failing is the honest answer. The forecourt's offline
story is Phase 3's IndexedDB queue, which holds readings and dips on the device
and syncs on reconnect. The offline page shows **no figures at all**, and says
why: an out-of-date number that looks current is worse than no number.

### Why the close is one database function

`close_shift()` writes readings, dips, sales, per-tank stock, credit rows,
lubricant movements, expenses and the cash count in a single transaction.
Either all of it lands or none of it does — a half-closed shift would leave the
chain broken and the next shift unable to open its book.

It runs as the caller, so every one of those writes is still checked by RLS.
The one thing needing elevated rights is the outbound n8n queue, which has no
insert policy by design; that goes through a narrow `SECURITY DEFINER` helper
that can touch `sync_queue` and nothing else.

`compute_shift_close()` works out every figure and writes nothing. The wizard
draws its reconciliation summary from it and `close_shift()` runs the same
function before writing, so what the manager signs off and what gets stored
cannot drift apart.

### How the offline queue stays honest

Every queued item carries its own id as `client_ref`, and `meter_readings` and
`tank_dips` both have a unique index on that column. Re-sending is therefore
free — the second attempt collides and is treated as delivered. Tested directly:
inserting a duplicate `client_ref` is refused, and the table still holds one row.

Two failures are told apart deliberately. A dropped connection leaves the item
queued and retries. A policy refusal — most often the phone was offline across a
shift change, so the shift the reading belongs to is now closed — is marked
*blocked* and surfaced to the employee as **"needs the manager"**, because no
number of retries will fix it.

What the phone computes is never the figure of record. The cached chart gives
the employee a live litre count at the rod; the database recomputes it from the
chart version in force at the moment the dip was taken.

### Three bugs the browser passes found

Neither showed up in the tests or the type checker, and both would have been
felt on the forecourt:

1. **Sign-out was unreachable.** `/auth/signout` was listed as a public path, and
   the middleware sends signed-in users away from public paths to their own
   dashboard — so the POST was redirected before it ever reached the route that
   clears the session. Everybody who could use sign-out was bounced off it.
2. **Sign-out would not have cleared the cookie even once reached.** The route
   cleared cookies through `cookies()` from next/headers and then returned a
   freshly constructed `NextResponse`, which drops them. On a phone shared
   between shift workers that leaves somebody else's session open.
3. **`POST /api/ocr/meter` never reached its route.** The same middleware guard
   was running the page-route access table over API paths, so a dispenser's OCR
   request was redirected to `/dispenser` and the client got an HTML page back
   with a 200 on it. API routes are now left to authenticate themselves — which
   also matters for Phase 8, where the inbound n8n webhooks authenticate by
   shared secret and have no session at all.

A fourth, found while testing the queue: `idb-keyval` creates a database
containing exactly the one object store it is given, so the queue and the
chart cache could not share the `jhm-offline` database — whichever opened
second threw `NotFoundError`. They now have a database each.

### Verified against the live database

Run as a transaction that rolled itself back, so none of it survives:

- `dip_to_litres` in Postgres returns the same figures as `dipToLitres` in
  TypeScript — 8,455 L and 8,679 L at 1450 mm, 12,000 L at each tank's own final
  dip, 8,458.5 L interpolated at 1450.5 mm on Tank 1.
- 2071 mm is refused on Tank 1 and 2052 mm on Tank 2; 2070 mm is refused on
  Tank 2 while remaining valid on Tank 1, which is the per-tank bound working.
- A dip row had its litres and chart version stamped by trigger.
- A −0.5% variance sat at the threshold without flagging; −1.0% flagged.
- A wrong `book_closing` and a broken stock chain were both refused.
- A hard delete on `shift_stock` was refused, and the audit log could not be
  edited.
- A credit sale and a part payment left the customer ledger at the right
  balance, posted by trigger.

One consequence worth knowing: because `tank_calibration` is an audited table,
loading the two charts wrote 4,121 rows into `audit_log`. That is the intended
behaviour — the certified chart is a legal record and its load belongs in the
trail — but it means the audit log starts with those rows rather than empty.

---

## The live project

The database runs on the Supabase project **JHM apps**
(`qvwmhzfxkrknlsldslxl`, ap-northeast-1). All twelve migrations are applied, and
both certified calibration charts are loaded and verified. `.env.local` already
points at it.

Two things are still needed before the app can be signed into: the
**service-role key** (Supabase dashboard → Project Settings → API) in
`.env.local`, and then `npm run seed` to create the four role accounts.

## Setup

```bash
npm install
```

### 1. Apply the migrations

Already applied to **JHM apps**. For a fresh project, run them in order:

```
supabase/migrations/0001_extensions_and_enums.sql   enums and extensions
supabase/migrations/0002_tables.sql                 33 tables
supabase/migrations/0003_indexes.sql                indexes
supabase/migrations/0004_functions.sql              calculations mirrored from lib/calc
supabase/migrations/0005_audit.sql                  audit trail, hard-delete block
supabase/migrations/0006_rls.sql                    row level security, storage buckets
supabase/migrations/0007_seed_static.sql            station, tanks, dispensers, categories
supabase/migrations/0008_calibration_tank1.sql      2,070 certified rows
supabase/migrations/0009_calibration_tank2.sql      2,051 certified rows
supabase/migrations/0010_harden_functions.sql       search_path, EXECUTE grants
supabase/migrations/0011_move_pg_trgm_out_of_public.sql
supabase/migrations/0012_document_security_definer_intent.sql
supabase/migrations/0013_admin_equipment_and_calibration_rpcs.sql
supabase/migrations/0014_shift_close_computation.sql   the close, computed and written nowhere
supabase/migrations/0015_reopen_shift.sql
supabase/migrations/0016_enqueue_sync_event_helper.sql
supabase/migrations/0017_close_shift.sql                the close, in one transaction
supabase/migrations/0018_tanker_delivery.sql            deliveries, shortage and costing
supabase/migrations/0019_credit_control.sql             limits, ageing, balance adjustments
supabase/migrations/0020_cash_chain_and_own_use.sql     the cash chain, own use at cost
supabase/migrations/0021_ledger_ordering.sql            the ledger chains on a sequence
supabase/migrations/0022_document_security_definer_intent.sql   the other three definers
supabase/migrations/0023_profit_and_loss.sql            costing fuel shift by shift
supabase/migrations/0024_daily_sheet.sql                the paper form, and its captions
supabase/migrations/0025_dashboard_kpis.sql             one source for four dashboards
supabase/migrations/0026_lubricant_sales_reach_the_close.sql    oil sold mid-shift counts
supabase/migrations/0027_rows_belong_to_their_shift.sql a night shift is not the next day
supabase/migrations/0028_chat_and_sync.sql               what the chat may ask, and the queue drain
supabase/migrations/0029_variance_floor.sql             a tolerance the dip rod can support
supabase/migrations/0030_shared_variance_rule_and_own_use_book.sql  one flag rule, three books
```

`0008` and `0009` are generated from `seed/*.csv` and refuse to load if the row
count, the endpoints, strict monotonicity or the checksum against the source CSV
does not match. `npm run seed` loads the same charts from the CSVs for any
environment where they are not already present, and skips when they are.

### 2. Accounts

The station's four working accounts:

| Role | Email | Lands on |
|---|---|---|
| Admin / Owner | `onik820@gmail.com` | `/admin` |
| Managing Director | `md@jhmfilling.com` | `/md` |
| Station Manager | `manager@jhmfilling.com` | `/manager` |
| Employee | `employee@jhmfilling.com` | `/dispenser` |

Their passwords are in `.env.local` as `STATION_*`, read by
`npm run check:accounts`. **They were written down so they could be handed
over, which is exactly what a password should never be — change all four.**

Four more accounts exist as development fixtures, one per role, at
`dispenser@jhm.test`, `manager@jhm.test`, `admin@jhm.test` and `md@jhm.test`.
`npm run verify:rls` signs in as those, so they stay until go-live and are
switched off from **People** after it. Their passwords are the `SEED_*` values
in `.env.local`.

#### Everyone else joins by invitation

The admin does not type anyone else's password, and never learns it.

```
admin opens /people  →  invites a name + email + role
                     →  a single-use link, shown once
person opens the link →  chooses their own password
                     →  lands on their own dashboard
```

The rules, all enforced in the database rather than in the form:

- an invitation can make a **manager or an employee only**. An admin or MD
  account is created deliberately, not by whoever is holding a URL
- the role is read off the invitation row at acceptance, never off the request,
  so editing the form does not change what you become
- the link is 256 bits of randomness, stored only as its sha256. A stolen
  backup of the table cannot be turned back into a working invitation
- it is single-use — the row is taken `for update`, so the same link opened in
  two tabs makes one account, not two
- a wrong, spent or expired link is told **nothing at all**, not even that it
  once existed
- someone who leaves is **switched off**, not deleted: their name is on months
  of shift closes and ledger rows, and those have to keep pointing somewhere

`npm run check:accounts` signs in as all four roles and walks that whole flow,
including the refusals. It is the check to run after any change to auth.

**Rotate all four before this system holds any real money.** They were created
to prove the role boundaries, not to be used by people. The intended path for
real accounts is `npm run seed` with `SUPABASE_SERVICE_ROLE_KEY` and your own
`SEED_*` values in `.env.local` — there are deliberately no default passwords,
because three of these four roles can see the station's money.

#### Creating an account without the service-role key

`npm run seed` goes through `auth.admin.createUser`, which needs
`SUPABASE_SERVICE_ROLE_KEY`. Without it, use `public.provision_account()` from
migration `0031` — it does the whole job in one transaction and gets the trap
below right. It is granted to nobody, so it is callable only from the SQL
editor and from `accept_invitation()`.

The trap is worth knowing about anyway, because it is what an account made by
hand runs into.

GoTrue scans four of its token columns into non-nullable strings. An insert
that leaves them `NULL` produces a row that looks perfectly correct in every
query — and every sign-in fails with the unhelpful **`Database error querying
schema`**. They have to be empty strings:

```sql
update auth.users
set confirmation_token     = coalesce(confirmation_token, ''),
    recovery_token         = coalesce(recovery_token, ''),
    email_change_token_new = coalesce(email_change_token_new, ''),
    email_change           = coalesce(email_change, '')
where email = '…';
```

A manual account also needs a matching `auth.identities` row — without one the
email provider has nothing to match on — and a `public.profiles` row, which is
where the app reads the role from. There is no trigger creating it.

The quickest check that any of this worked is to sign in as the account and
ask for something only its role may see, rather than trusting that the rows
look right.

### 3. Prove the security boundary

```bash
npm run verify:rls
```

Signs in as each role and checks what it can reach. The check Phase 1 is judged
on is the first one: a `dispenser` cannot select from `expenses`. This needs the
seed accounts from step 2.

### 4. Run it

```bash
npm run dev
```

Each role signs in and lands on its own dashboard: `/dispenser`, `/manager`,
`/admin`, `/md`.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Vitest — every calculation in `lib/calc/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | Calibration charts and seed users |
| `npm run verify:rls` | Proves the RLS boundary against a live database |
| `npm run verify:phase6` | Credit limits, ageing, the cash chain and own use, run as the real signed-in roles |
| `npm run check:render` | Renders each signed-in page against a running dev server and checks its figures |
| `npm run seed:demo` | Builds one full trading day so the reports have something to be right about |
| `npm run check:reports` | Every report renders for the right roles; the Daily Sheet and the workbook agree with the database |
| `npm run check:a11y` | Contrast against the glass, plus the markup mistakes that actually happen |
| `npm run check:chat` | The assistant answers under the asker's own RLS, cannot write, and the inbound routes refuse without their secret |
| `npm run check:accounts` | Every role signs in and lands right; the invitation flow and all seven of its refusals |

`verify:phase6` writes to the live database and prints the ids it created; it
deliberately cannot clean up after itself, because a script that can reach for
the hard-delete escape hatch is a script that can erase a real ledger.

**Never run `npm run build` while a dev server is running.** It rewrites
`.next` underneath the running server, which then serves HTML whose JavaScript
chunks 404. The page renders and never hydrates, so it looks like a broken
component rather than a broken build. The same goes for two dev servers at
once — they share `.next` and corrupt each other. If a page looks dead in dev,
check whether the chunks are 404ing before suspecting the code.

---

## Environment variables

See `.env.example` for the full list with notes.

| Variable | Where it is used |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server; every query is governed by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only.** Bypasses RLS — seed script, n8n inbound routes, sync worker |
| `ANTHROPIC_API_KEY` | **Server only**, read solely inside `/api/ocr/meter` |
| `N8N_EVENT_WEBHOOK` | Outbound event mirror |
| `NEXT_PUBLIC_N8N_CHAT_WEBHOOK` | Chat panel |
| `N8N_INBOUND_SECRET` | Shared secret on both inbound n8n routes |
| `SEED_*_EMAIL` / `SEED_*_PASSWORD` | One account per role |

The Anthropic key never reaches the browser. It is read only inside a server
route.

---

## Layout

```
app/                    Routes. One dashboard per role.
components/             Shared UI, including the glass surfaces and tank gauge.
lib/calc/               Every calculation, as pure functions with tests beside them.
lib/data/               Queries, and the boundary where a Postgres numeric stops being a float.
lib/reports/            One definition per report, shared by screen, workbook and print.
lib/supabase/           Browser, server and service-role clients.
lib/i18n/               Bangla and English dictionaries.
supabase/migrations/    Schema, functions, audit triggers, RLS, static seed.
scripts/                Seed, RLS verification, phase acceptance, render checks.
seed/                   The two certified BSTI calibration charts.
docs/                   Calculations, roles, n8n contract.
```

---

## Confirm before go-live

Six things were seeded as documented assumptions. **Three are now settled** and
are struck through below; the rest are still open. Each is a row in the
database, so correcting one is an admin edit, not a migration.

1. **Which dispenser draws from which tank.** Seeded as M1 and M2 → Tank 1,
   M3 and M4 → Tank 2. Per-tank variance is meaningless if this is wrong.
   **Still open.**
2. ~~Nozzles per dispenser and totalizer digits.~~ **Confirmed:** one nozzle
   per dispenser, 8-digit meters, as seeded. Nothing to change.
3. **The 21 credit parties.** Seeded as inactive placeholders with zero opening
   balance, so no sale can be booked against one by mistake. **The manager and
   the admin will type these in** — the Dues screen does all of it: rename, set
   the credit limit, set the opening balance *and the date it is owed from*,
   then activate. That date is not optional detail: without it a year-old debt
   ages the same as last Tuesday's, and the sheet says so on the party's face
   until it is filled in.
4. ~~Where lubricant own-use books.~~ **Confirmed: its own book.** Oil issued
   to the station's lorries now sits in an `own_use` group, reported on its own
   line — neither a running cost the manager answers for nor money the owner
   drew. It still comes off operating profit, because the oil really did leave
   the business. The Own use book is read-only on screen: those rows are
   written by the lubricant module, so the expense form never offers that head.
5. **What the fuel already in the tanks cost.** Until an opening valuation is
   set, the first delivery prices each tank at that day's depot rate. That is
   defensible but it is not the real figure, and it feeds every profit number
   afterwards. **Still open, and the most expensive of these to leave.**

6. **The Daily Sheet's headings and five signature captions.** Seeded from the
   usual order of responsibility at a dealership, because the paper form has
   not been seen. They live in `settings.daily_sheet_labels` in both languages;
   correcting them is one edit, and the sheet prints a notice on its own face
   until `confirmed` is set. **Send a photo of the form and this is a
   five-minute job.**

**Remove the demo trading day before real money goes in.** `npm run seed:demo`
writes a full day dated 2026-09-18 with three parties prefixed `DEMO`, so the
reports have something to be right about. The teardown is in
[docs/demo-day.md](docs/demo-day.md).

### The variance tolerance, settled

Asked what it should be, the answer was "whatever makes the counting accurate",
so it starts from what the station can measure rather than a number that sounds
strict. From the certified charts, across the working range, **one millimetre
of dip rod is 6.87 litres** on both tanks.

Only one figure in a close is read off a rod: `book_opening` is carried forward
from the previous shift, already reconciled, while `physical_closing` is a wet
line read by eye. So the measurement error is about ±7 L.

A percentage alone misbehaves at both ends — 5 L out on a quiet 200 L shift is
2.5% and flags, though it is rod noise; 25 L out on a busy 5,000 L shift is
0.5% and does not, though it is real money. The first is the damaging one: a
manager who writes "rod reading" every quiet night learns the box is a
formality, and on the night it matters the note says the same thing.

So a variance flags when it is **both** past ±0.5% **and** bigger than one
millimetre of rod. Verified at the boundaries:

| Variance | Of litres sold | Flagged | |
|---|---|---|---|
| 5 L | 2.5% | no | rod noise on a quiet shift |
| 7 L | 1.0% | no | exactly one millimetre |
| 9.6 L | 0.96% | **yes** | Phase 4's injected discrepancy, still caught |
| 11 L | 0.63% | **yes** | the demo day's T2, still caught |
| 25 L | 0.50% | no | exactly on the percentage |
| 26 L | 0.52% | **yes** | just past it |
| 40 L | nothing sold | **yes** | a leak or a theft, never noise |

Both settings live in `settings` (`variance_threshold_pct`,
`variance_floor_litres`). Raise the floor to 14 if the rods turn out to be read
to the nearest 2 mm in practice.

The rule itself now lives in one function, `variance_is_flagged()`. It had been
written out three times — in the chain trigger, in `recalculate_from` and in
`compute_shift_close` — and three copies of a threshold are three thresholds
waiting to disagree.

One further default may still need tuning: the 0.3% tanker shortage tolerance.

**Both calibration charts expire on 30-01-2027.** The admin dashboard starts
warning 90 days before, and dip entry is blocked against an expired chart unless
an admin overrides with a reason.

---

## Deploy

Nothing in the build needs a secret — if a key is missing the app starts and
says so on the screen that needs it, rather than failing to boot. So the build
is the same everywhere: `npm run build`, then `npm start`.

**Hostinger:** see **[DEPLOY-HOSTINGER.md](DEPLOY-HOSTINGER.md)**, which covers
both the managed Node.js path on Business/Cloud and a VPS with pm2 and nginx,
and the one thing that does not carry over — `vercel.json`'s cron has to be
recreated as an ordinary scheduled `curl`.

**Vercel:** import the repository and accept the defaults. The rest of this
section is written for that.

### Environment variables

Set these in the Vercel project. Only the `NEXT_PUBLIC_` pair is exposed to the
browser; every other value is server-side only and must never be given that
prefix.

| Variable | Needed for | If it is missing |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | everything | the app will not start |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | everything | the app will not start |
| `SUPABASE_SERVICE_ROLE_KEY` | the seed script, the n8n inbound routes, the queue drain | those refuse with `503`; the app is otherwise fine |
| `ANTHROPIC_API_KEY` | reading meter photos | the capture screen falls back to typing the reading |
| `ANTHROPIC_MODEL` | — | defaults to `claude-sonnet-4-5` |
| `OPENAI_API_KEY` | the chat assistant | the panel answers that it cannot answer yet, and still records the question |
| `OPENAI_MODEL` | — | defaults to `gpt-4o-mini` |
| `OPENAI_TRANSCRIBE_MODEL` | Bangla speech where the browser has none | defaults to `whisper-1` |
| `N8N_EVENT_WEBHOOK` | mirroring events to Google Sheets | the queue fills and nothing is lost; the drain reports it is skipping |
| `N8N_INBOUND_SECRET` | `/api/n8n/chat` and `/api/n8n/command` | **those routes are closed**, which is the safe default |
| `NEXT_PUBLIC_N8N_CHAT_WEBHOOK` | routing chat through n8n instead of `/api/chat` | unused by default |
| `N8N_TRANSCRIBE_WEBHOOK` | sending voice clips to n8n rather than OpenAI | falls back to OpenAI |
| `SYNC_DRAIN_SECRET` | calling `/api/sync/drain` by hand | falls back to `N8N_INBOUND_SECRET`; Vercel cron is recognised by its own header |

The seed accounts in `.env.local` are for local development only and have no
business in a Vercel project.

### The cron

`vercel.json` schedules `GET /api/sync/drain` every five minutes. That is what
carries committed events to n8n and on to the Sheets workbooks. It is safe to
run twice at once and safe to miss — a failed sync never touches a local
record, and the queue keeps the event with its backoff.

Check on it any time:

```bash
curl -H "Authorization: Bearer $SYNC_DRAIN_SECRET" https://<your-app>/api/sync/drain
```

A `GET` without the cron header reports the mirror's health and drains nothing.

### Before the first real shift

```bash
npm run seed            # calibration charts, tanks, dispensers, categories, one user per role
npm run verify:rls      # proves the role boundary against the live database
```

Then work through **Confirm before go-live** above, and **rotate the four
seeded passwords** — they were generated for development and are in a file on a
developer's machine.

Two Supabase dashboard settings are not in code and need doing by hand:

- **Enable leaked-password protection** (Auth → Policies). The advisor flags it
  until you do.
- **Review the SECURITY DEFINER functions** the linter reports. All of them are
  deliberate and each carries a comment saying why; migrations `0012`, `0022`
  and `0033` are the written record. `0033` also exists because of a real
  finding: Postgres grants EXECUTE to PUBLIC by default, so the admin-only
  invitation functions were reachable by `anon` until they were explicitly
  revoked. Each refused an anon caller on its own, so nothing leaked — but an
  API surface that disagrees with the function behind it is a surface nobody
  can reason about.

### Checks worth running against a deployment

```bash
npm run check:a11y                                   # contrast and markup, no server needed
npm run check:render   -- https://<your-app>         # every page renders with the right figures
npm run check:reports  -- https://<your-app>         # reports, roles, the workbook
npm run check:chat     -- https://<your-app>         # the assistant's boundaries
```

The last three sign in as the seeded roles, so they belong against staging
rather than a production database holding real money.
