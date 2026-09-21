-- ============================================================================
-- 0022 — Why seven functions stay SECURITY DEFINER
--
-- 0012 explained four of them. Phases 4 and 5 added three more and nobody went
-- back to the list, so the linter's seven findings were being read against a
-- note that covered four. A reviewer who cannot tell which of the seven were
-- decided on and which merely happened has to treat all of them as suspect,
-- which is the opposite of what the note is for.
--
-- Phase 6 added no SECURITY DEFINER functions. Credit control, ageing, the
-- cash chain and the lubricant triggers all run as the caller, so RLS decides
-- what each role can reach in the ordinary way.
-- ============================================================================

comment on function public.enqueue_sync_event(text, jsonb, text) is
  'SECURITY DEFINER on purpose, and deliberately narrow. sync_queue has no '
  'insert policy — nothing may write to the outbound queue directly. '
  'close_shift() and record_tanker_delivery() run as the caller so every '
  'financial write they make is still checked by RLS, which leaves them unable '
  'to enqueue the event that follows. This is the one door through that wall: '
  'it takes an event type, a payload and an idempotency key, writes one row, '
  'and returns nothing a caller could mine for data.';

comment on function public.record_tank_cost(uuid, numeric, numeric, numeric, timestamptz, uuid) is
  'SECURITY DEFINER because the moving average cannot be computed without '
  'reading the previous cost, and tank_cost_history is hidden from a manager '
  'by policy — the role that records most deliveries. Running as the caller '
  'meant the read came back empty, every tank looked new, and each delivery '
  're-based the whole tank at that day''s depot rate instead of blending. The '
  'function therefore computes and writes the new average but returns nothing, '
  'so a manager cannot read the figure back out of a contrived call.';

comment on function public.compute_tanker_delivery(jsonb) is
  'SECURITY DEFINER so the preview can price a delivery using the same costing '
  'path record_tanker_delivery() will use, rather than a second implementation '
  'that could drift from it. It writes nothing. The cost keys are stripped '
  'from its result for any caller who is not an admin or the MD, so a manager '
  'gets the litres and the shortage and no blended cost.';
