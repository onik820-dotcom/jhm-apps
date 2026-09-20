# n8n integration

> **Status: built.** The queue, the drain route, both inbound routes and the
> importable workflow all exist. What is not proven is the round trip to a live
> n8n instance, because none is wired yet — set the three environment variables
> below and it runs.

The app is the system of record. Google Sheets is a mirror. **A failed sync must
never block or roll back a local write** — if n8n is down, the shift still
closes, and the event is retried afterwards.

---

## Outbound events

After every committed transaction the server inserts a row into `sync_queue` and
POSTs it to `N8N_EVENT_WEBHOOK`.

| Event | Fires when |
|---|---|
| `shift.closed` | A manager signs off a shift |
| `meter.recorded` | A meter reading is saved and confirmed |
| `dip.recorded` | A tank dip is saved |
| `refill.received` | A tanker delivery is recorded |
| `credit_sale.created` | A party-wise credit sale is entered |
| `payment.received` | A customer payment is recorded |
| `expense.created` | An expense is recorded |
| `variance.exceeded` | Stock variance passes the threshold — immediately, not at month end |
| `stock.low` | Days of cover falls below the threshold |
| `credit_limit.exceeded` | A credit sale would push a party past its limit |

### Payload

```json
{
  "event": "shift.closed",
  "occurred_at": "2026-09-19T18:04:11+06:00",
  "station_id": "00000000-0000-0000-0000-000000000001",
  "actor": { "id": "…", "role": "manager", "name": "…" },
  "data": { },
  "idempotency_key": "shift.closed:<shift_id>"
}
```

`idempotency_key` is unique in `sync_queue`, so the same event is never queued
twice — a double sign-off produces one row and one POST.

### Retry

Exponential backoff, five attempts (`settings.sync_max_attempts`), then the row
is marked `failed` and an alert is raised for the admin. `attempts`,
`last_error` and `next_attempt_at` on `sync_queue` carry the state.

---

## Inbound routes

Both require a shared secret in the `X-N8N-Secret` header, compared against
`N8N_INBOUND_SECRET` with a constant-time comparison. A request without it is
refused before anything is read.

### `POST /api/n8n/chat`

Routes an assistant reply back to the right chat session.

```json
{ "session_id": "…", "user_id": "…", "content": "…", "content_lang": "bn", "n8n_request_id": "…" }
```

### `POST /api/n8n/command`

Lets a flow write a record — for example an expense logged over WhatsApp. It
runs the **same zod validation and the same RLS role checks as the UI**: the
route resolves the acting user and writes as them, never as an anonymous
service-role bypass.

```json
{ "command": "expense.create", "actor_id": "…", "idempotency_key": "…", "data": { } }
```

---

## Idempotency

Every mutating API route accepts an `Idempotency-Key` header. The key, the route
and a hash of the request body are stored in `idempotency_keys` along with the
first response. A repeat of the same key returns that stored response instead of
writing again — a double-tap on the forecourt cannot create two records.

---

## Google Sheets mirror

The workflow appends each event to the tab matching its name, so the existing
workbooks keep filling: Pump Sheet, Can Lub, Due Customer Ledger, Espenditure.

The importable workflow is [docs/n8n-workflow.json](n8n-workflow.json). Import it
into n8n, set the three variables it reads (`JHM_INBOUND_SECRET`,
`JHM_BASE_URL`, `JHM_SHEET_ID`), and connect a Google account to the Sheets
node. It appends on `idempotency_key`, so a retried event updates its own row
rather than writing a duplicate — the app already dedupes, but a mirror should
not depend on the thing it mirrors.

---

## Environment

```
N8N_EVENT_WEBHOOK=           # outbound events
NEXT_PUBLIC_N8N_CHAT_WEBHOOK= # chat, called from the browser
N8N_INBOUND_SECRET=          # shared secret for both inbound routes
```

---

## Draining the queue

`POST /api/sync/drain` claims up to 20 due events, POSTs each to
`N8N_EVENT_WEBHOOK`, and marks them sent or failed. Vercel cron calls it every
five minutes (`vercel.json`); a `GET` without the cron header reports the
mirror's health instead of draining, which is handy from a browser.

It is safe to run two at once. `claim_sync_batch()` takes its rows
`FOR UPDATE SKIP LOCKED`, so two passes never fight over the same event, and
attempts is bumped at claim time rather than after the POST — a drainer that
dies mid-request leaves a row that will be retried once more, not forever.

Authorisation is the `x-vercel-cron` header, or `Authorization: Bearer` against
`SYNC_DRAIN_SECRET` (falling back to `N8N_INBOUND_SECRET`), compared in constant
time.

### The retry chain, as verified

| Attempt | Next try | What is recorded |
|---|---|---|
| 1 | +1 min | `last_error`, back to `pending` |
| 2 | +2 min | |
| 3 | +4 min | |
| 4 | +8 min | |
| 5 | +16 min | |
| 5 reached | never | `status = 'failed'`, and a **critical alert** for the admin |

A backed-off row is skipped until it is due, and a row the queue has given up
on is never picked up again. The alert matters: the local record is now ahead
of Sheets, and that is something somebody has to know rather than discover.

---

## Why the chat does not go through n8n

Section 6.11 describes the chat POSTing to `NEXT_PUBLIC_N8N_CHAT_WEBHOOK` and
n8n answering. It answers in `/api/chat` instead, and the reason is Row Level
Security.

For n8n to answer a question about live data it would have to query Supabase,
and it would do so with a service-role key — which bypasses RLS entirely. Every
role boundary in this project would then be one question away from collapsing:
a manager who cannot open the Profit & Loss screen could simply ask the chat
*"ei mash e profit koto?"* and be told.

Answering in our own route means every read runs on the **asker's** Supabase
session. `profit_and_loss()` raises `insufficient_privilege` for a manager in
the chat exactly as it does on the screen, and the assistant relays the refusal
instead of the figure. Prompting a model not to reveal something is a wish;
letting the database refuse is a rule.

`POST /api/n8n/chat` still exists for the other direction — a conversation that
started in WhatsApp and needs its reply delivered into a session.

---

## Why `/api/n8n/command` does not use the service-role key to write

It holds one, but only to answer *who is asking*. It then mints a session for
that person and performs the write as them, so every policy, trigger and audit
row behaves as though they had typed it on a screen.

The consequence is the point: a flow cannot make a dispenser book an expense,
because a dispenser may not. A flow cannot push a party past its credit limit,
because `enforce_credit_limit` still fires. The shared secret gets a caller to
the door, not past the rules.
