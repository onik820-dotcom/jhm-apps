import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { dec } from '@/lib/calc/decimal';

export interface CloseNozzle {
  nozzleId: string;
  dispenserCode: string;
  nozzleNo: number;
  tankId: string;
  tankCode: string;
  meterDigits: number;
  maxFlowLpm: string;
  /** Previous shift's closing reading, or this shift's opening one. */
  openingReading: string | null;
  openingSource: 'previous_close' | 'this_shift_open' | null;
  /**
   * A closing reading a dispenser already submitted for this shift, used to
   * prefill the wizard. The manager still confirms it: the submission and the
   * confirmation are both kept, which is what makes the trail worth having.
   */
  submittedClosing: string | null;
  submittedConfidence: number | null;
}

export interface CloseTank {
  id: string;
  code: string;
  finalDipMm: number;
  /** Where the book starts: the last shift's closing, or this shift's opening dip. */
  bookOpening: string | null;
  bookOpeningSource: 'previous_close' | 'opening_dip' | null;
}

export interface ClosePartyOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface CloseContext {
  shift: {
    id: string;
    shiftDate: string;
    shiftType: 'day' | 'night';
    startsAt: string;
    endsAt: string;
    status: string;
    ratePerLitre: string | null;
  } | null;
  nozzles: CloseNozzle[];
  tanks: CloseTank[];
  customers: ClosePartyOption[];
  lubSkus: Array<{ id: string; name: string; saleRate: string; packType: string }>;
  expenseCategories: Array<{ id: string; name: string; nameBn: string | null; group: string }>;
  /** The previous shift's counted cash becomes this shift's opening cash. */
  openingCash: string;
  lastRate: string | null;
}

/**
 * Everything the close wizard needs, in one round trip.
 *
 * The opening figures matter most here: a closing reading is meaningless
 * without the reading it follows, and a book closing is meaningless without the
 * book opening it continues from. Both are shown read-only in the wizard so the
 * manager can see the chain they are extending.
 */
export async function getCloseContext(): Promise<CloseContext> {
  const supabase = await createClient();

  const { data: shiftRow } = await supabase
    .from('shifts')
    .select('id, shift_date, shift_type, starts_at, ends_at, status, rate_per_litre')
    .in('status', ['open', 'closing', 'reopened'])
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const empty: CloseContext = {
    shift: null,
    nozzles: [],
    tanks: [],
    customers: [],
    lubSkus: [],
    expenseCategories: [],
    openingCash: '0.00',
    lastRate: null,
  };

  if (!shiftRow) return empty;

  const shift = {
    id: shiftRow.id as string,
    shiftDate: shiftRow.shift_date as string,
    shiftType: shiftRow.shift_type as 'day' | 'night',
    startsAt: shiftRow.starts_at as string,
    endsAt: shiftRow.ends_at as string,
    status: shiftRow.status as string,
    ratePerLitre: shiftRow.rate_per_litre ? dec(shiftRow.rate_per_litre).toFixed(2) : null,
  };

  const [nozzleRes, tankRes, customerRes, skuRes, categoryRes, prevCashRes, lastRateRes] = await Promise.all([
    supabase
      .from('nozzles')
      .select('id, nozzle_no, status, dispensers!inner(id, code, status, deleted_at, meter_digits, max_flow_lpm, tank_id, tanks(code))')
      .is('deleted_at', null)
      .eq('status', 'active'),
    supabase
      .from('tanks')
      .select('id, code, status, tank_metadata(final_dip_mm)')
      .is('deleted_at', null)
      .neq('status', 'removed')
      .order('code'),
    supabase
      .from('customers')
      .select('id, name, is_active')
      .is('deleted_at', null)
      .order('name'),
    supabase
      .from('lub_skus')
      .select('id, name, current_sale_rate, pack_type')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('expense_categories')
      .select('id, name, name_bn, group')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('cash_reconciliation')
      .select('counted_cash, shifts!inner(starts_at)')
      .lt('shifts.starts_at', shift.startsAt)
      .order('shifts(starts_at)', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('shift_sales')
      .select('rate_per_litre, shifts!inner(starts_at)')
      .lt('shifts.starts_at', shift.startsAt)
      .order('shifts(starts_at)', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // ---- nozzles, each with the reading it follows ---------------------------
  const rawNozzles = (nozzleRes.data ?? []) as unknown as Array<{
    id: string;
    nozzle_no: number;
    dispensers: {
      id: string;
      code: string;
      status: string;
      deleted_at: string | null;
      meter_digits: number;
      max_flow_lpm: string;
      tank_id: string;
      tanks: { code: string } | null;
    } | null;
  }>;

  const nozzles: CloseNozzle[] = await Promise.all(
    rawNozzles
      .filter((n) => n.dispensers && n.dispensers.status === 'active' && !n.dispensers.deleted_at)
      .map(async (n) => {
        const d = n.dispensers!;

        const { data: submitted } = await supabase
          .from('meter_readings')
          .select('reading, ai_confidence')
          .eq('nozzle_id', n.id)
          .eq('shift_id', shift.id)
          .eq('reading_type', 'close')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const submittedClosing = submitted?.reading ? dec(submitted.reading).toFixed(2) : null;
        const submittedConfidence = submitted?.ai_confidence != null ? Number(submitted.ai_confidence) : null;

        const { data: previous } = await supabase
          .from('meter_readings')
          .select('reading, shifts!inner(starts_at)')
          .eq('nozzle_id', n.id)
          .eq('reading_type', 'close')
          .is('deleted_at', null)
          .lt('shifts.starts_at', shift.startsAt)
          .order('shifts(starts_at)', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (previous?.reading) {
          return {
            nozzleId: n.id,
            dispenserCode: d.code,
            nozzleNo: n.nozzle_no,
            tankId: d.tank_id,
            tankCode: d.tanks?.code ?? '—',
            meterDigits: d.meter_digits,
            maxFlowLpm: d.max_flow_lpm,
            openingReading: dec(previous.reading).toFixed(2),
            openingSource: 'previous_close' as const,
            submittedClosing,
            submittedConfidence,
          };
        }

        const { data: ownOpen } = await supabase
          .from('meter_readings')
          .select('reading')
          .eq('nozzle_id', n.id)
          .eq('shift_id', shift.id)
          .eq('reading_type', 'open')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        return {
          nozzleId: n.id,
          dispenserCode: d.code,
          nozzleNo: n.nozzle_no,
          tankId: d.tank_id,
          tankCode: d.tanks?.code ?? '—',
          meterDigits: d.meter_digits,
          maxFlowLpm: d.max_flow_lpm,
          openingReading: ownOpen?.reading ? dec(ownOpen.reading).toFixed(2) : null,
          openingSource: ownOpen?.reading ? ('this_shift_open' as const) : null,
          submittedClosing,
          submittedConfidence,
        };
      }),
  );

  nozzles.sort((a, b) => a.dispenserCode.localeCompare(b.dispenserCode) || a.nozzleNo - b.nozzleNo);

  // ---- tanks, each with the book figure it continues from ------------------
  const rawTanks = (tankRes.data ?? []) as unknown as Array<{
    id: string;
    code: string;
    tank_metadata: Array<{ final_dip_mm: number }> | null;
  }>;

  const tanks: CloseTank[] = await Promise.all(
    rawTanks
      .filter((t) => t.tank_metadata?.[0]?.final_dip_mm)
      .map(async (t) => {
        const { data: previous } = await supabase
          .from('shift_stock')
          .select('book_closing, shifts!inner(starts_at)')
          .eq('tank_id', t.id)
          .lt('shifts.starts_at', shift.startsAt)
          .order('shifts(starts_at)', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (previous?.book_closing) {
          return {
            id: t.id,
            code: t.code,
            finalDipMm: t.tank_metadata![0]!.final_dip_mm,
            bookOpening: dec(previous.book_closing).toFixed(3),
            bookOpeningSource: 'previous_close' as const,
          };
        }

        const { data: openDip } = await supabase
          .from('tank_dips')
          .select('litres')
          .eq('tank_id', t.id)
          .eq('shift_id', shift.id)
          .eq('dip_type', 'open')
          .is('deleted_at', null)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        return {
          id: t.id,
          code: t.code,
          finalDipMm: t.tank_metadata![0]!.final_dip_mm,
          bookOpening: openDip?.litres ? dec(openDip.litres).toFixed(3) : null,
          bookOpeningSource: openDip?.litres ? ('opening_dip' as const) : null,
        };
      }),
  );

  return {
    shift,
    nozzles,
    tanks,
    customers: ((customerRes.data ?? []) as Array<{ id: string; name: string; is_active: boolean }>).map((c) => ({
      id: c.id,
      name: c.name,
      isActive: c.is_active,
    })),
    lubSkus: ((skuRes.data ?? []) as Array<{ id: string; name: string; current_sale_rate: string; pack_type: string }>).map(
      (s) => ({ id: s.id, name: s.name, saleRate: dec(s.current_sale_rate).toFixed(2), packType: s.pack_type }),
    ),
    expenseCategories: ((categoryRes.data ?? []) as Array<{ id: string; name: string; name_bn: string | null; group: string }>).map(
      (c) => ({ id: c.id, name: c.name, nameBn: c.name_bn, group: c.group }),
    ),
    openingCash: prevCashRes.data?.counted_cash ? dec(prevCashRes.data.counted_cash).toFixed(2) : '0.00',
    lastRate: lastRateRes.data?.rate_per_litre ? dec(lastRateRes.data.rate_per_litre).toFixed(2) : null,
  };
}
