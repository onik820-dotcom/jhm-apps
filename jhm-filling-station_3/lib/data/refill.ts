import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { dec, decOr0 } from '@/lib/calc/decimal';

export interface RefillTank {
  id: string;
  code: string;
  finalDipMm: number;
  capacityLitres: string;
  /** Where the rod sits now, so the form can prefill the first dip-before. */
  currentDipMm: string | null;
  currentLitres: string | null;
  safeLimitLitres: string;
  headroomLitres: string | null;
}

export interface DeliveryRow {
  id: string;
  challanNo: string | null;
  truckReg: string | null;
  driverName: string | null;
  arrivedAt: string;
  depotRate: string;
  totalDeclared: string;
  totalReceived: string;
  totalShortage: string;
  shortagePct: string | null;
  /** Admin and MD only — RLS returns no cost rows to a manager. */
  purchaseValue: string;
  compartments: Array<{
    compartmentNo: number;
    tankCode: string;
    declaredLitres: string;
    dipBeforeMm: string;
    dipAfterMm: string;
    receivedLitres: string;
    shortageLitres: string;
    shortagePct: string | null;
    shortageFlagged: boolean;
  }>;
}

export interface PurchaseTotals {
  litres: string;
  value: string;
  shortage: string;
  deliveries: number;
}

export interface PurchaseRegister {
  byTank: Array<{ tankCode: string; day: PurchaseTotals; month: PurchaseTotals; year: PurchaseTotals }>;
  overall: { day: PurchaseTotals; month: PurchaseTotals; year: PurchaseTotals };
}

const OVERFILL_LIMIT_PCT = 95;

export async function getRefillTanks(): Promise<RefillTank[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tanks')
    .select('id, code, capacity_litres, status, tank_metadata(final_dip_mm)')
    .is('deleted_at', null)
    .eq('status', 'active')
    .order('code');

  if (error || !data) return [];

  return Promise.all(
    (data as unknown as Array<{
      id: string;
      code: string;
      capacity_litres: string;
      tank_metadata: Array<{ final_dip_mm: number }> | null;
    }>)
      .filter((t) => t.tank_metadata?.[0]?.final_dip_mm)
      .map(async (t) => {
        const { data: dip } = await supabase
          .from('tank_dips')
          .select('dip_mm, litres')
          .eq('tank_id', t.id)
          .is('deleted_at', null)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const capacity = dec(t.capacity_litres);
        const safeLimit = capacity.times(OVERFILL_LIMIT_PCT).dividedBy(100);
        const current = dip?.litres ? dec(dip.litres) : null;

        return {
          id: t.id,
          code: t.code,
          finalDipMm: t.tank_metadata![0]!.final_dip_mm,
          capacityLitres: capacity.toFixed(3),
          currentDipMm: dip?.dip_mm ? dec(dip.dip_mm).toString() : null,
          currentLitres: current ? current.toFixed(3) : null,
          safeLimitLitres: safeLimit.toFixed(3),
          headroomLitres: current ? safeLimit.minus(current).toFixed(3) : null,
        } satisfies RefillTank;
      }),
  );
}

/** Recent deliveries with their compartment breakdown, newest first. */
export async function getDeliveries(limit = 20): Promise<DeliveryRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tanker_deliveries')
    .select(
      'id, challan_no, truck_reg, driver_name, arrived_at, depot_rate, ' +
        'total_declared, total_received, total_shortage, purchase_value, ' +
        'tanker_compartments(compartment_no, declared_litres, dip_before_mm, dip_after_mm, ' +
        'received_litres, shortage_litres, shortage_pct, shortage_flagged, tanks(code))',
    )
    .is('deleted_at', null)
    .order('arrived_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as unknown as Array<{
    id: string;
    challan_no: string | null;
    truck_reg: string | null;
    driver_name: string | null;
    arrived_at: string;
    depot_rate: string;
    total_declared: string;
    total_received: string;
    total_shortage: string;
    purchase_value: string;
    tanker_compartments: Array<{
      compartment_no: number;
      declared_litres: string;
      dip_before_mm: string;
      dip_after_mm: string;
      received_litres: string;
      shortage_litres: string;
      shortage_pct: string | null;
      shortage_flagged: boolean;
      tanks: { code: string } | null;
    }>;
  }>).map((d) => {
    const declared = dec(d.total_declared);
    return {
      id: d.id,
      challanNo: d.challan_no,
      truckReg: d.truck_reg,
      driverName: d.driver_name,
      arrivedAt: d.arrived_at,
      depotRate: dec(d.depot_rate).toFixed(2),
      totalDeclared: declared.toFixed(3),
      totalReceived: dec(d.total_received).toFixed(3),
      totalShortage: dec(d.total_shortage).toFixed(3),
      shortagePct: declared.isZero()
        ? null
        : dec(d.total_shortage).dividedBy(declared).times(100).toDecimalPlaces(4).toFixed(4),
      purchaseValue: dec(d.purchase_value).toFixed(2),
      compartments: [...d.tanker_compartments]
        .sort((a, b) => a.compartment_no - b.compartment_no)
        .map((c) => ({
          compartmentNo: c.compartment_no,
          tankCode: c.tanks?.code ?? '—',
          declaredLitres: dec(c.declared_litres).toFixed(3),
          dipBeforeMm: dec(c.dip_before_mm).toString(),
          dipAfterMm: dec(c.dip_after_mm).toString(),
          receivedLitres: dec(c.received_litres).toFixed(3),
          shortageLitres: dec(c.shortage_litres).toFixed(3),
          shortagePct: c.shortage_pct ? dec(c.shortage_pct).toFixed(4) : null,
          shortageFlagged: c.shortage_flagged,
        })),
    };
  });
}

function emptyTotals(): PurchaseTotals {
  return { litres: '0.000', value: '0.00', shortage: '0.000', deliveries: 0 };
}

/**
 * Purchases tank by tank over the day, the month and the year.
 *
 * Litres are attributed by compartment, because a single tanker routinely
 * feeds both tanks and the register is only useful if it says which one took
 * what. Value is apportioned by the litres each tank actually received.
 */
export async function getPurchaseRegister(now = new Date()): Promise<PurchaseRegister> {
  const supabase = await createClient();

  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();

  const { data, error } = await supabase
    .from('tanker_compartments')
    .select(
      'received_litres, shortage_litres, delivery_id, tanks(code), ' +
        'tanker_deliveries!inner(arrived_at, depot_rate, deleted_at)',
    )
    .gte('tanker_deliveries.arrived_at', startOfYear)
    .is('tanker_deliveries.deleted_at', null);

  if (error || !data) {
    return { byTank: [], overall: { day: emptyTotals(), month: emptyTotals(), year: emptyTotals() } };
  }

  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const buckets = new Map<
    string,
    { day: PurchaseTotals; month: PurchaseTotals; year: PurchaseTotals; seen: Record<string, Set<string>> }
  >();
  const overall = { day: emptyTotals(), month: emptyTotals(), year: emptyTotals() };
  const overallSeen: Record<string, Set<string>> = { day: new Set(), month: new Set(), year: new Set() };

  function add(target: PurchaseTotals, litres: string, value: string, shortage: string) {
    target.litres = dec(target.litres).plus(litres).toFixed(3);
    target.value = dec(target.value).plus(value).toFixed(2);
    target.shortage = dec(target.shortage).plus(shortage).toFixed(3);
  }

  for (const row of data as unknown as Array<{
    received_litres: string;
    shortage_litres: string;
    delivery_id: string;
    tanks: { code: string } | null;
    tanker_deliveries: { arrived_at: string; depot_rate: string } | null;
  }>) {
    if (!row.tanker_deliveries) continue;
    const code = row.tanks?.code ?? '—';
    const at = new Date(row.tanker_deliveries.arrived_at);
    const litres = decOr0(row.received_litres);
    const value = litres.times(decOr0(row.tanker_deliveries.depot_rate)).toDecimalPlaces(2).toFixed(2);
    const shortage = decOr0(row.shortage_litres).toFixed(3);

    if (!buckets.has(code)) {
      buckets.set(code, {
        day: emptyTotals(),
        month: emptyTotals(),
        year: emptyTotals(),
        seen: { day: new Set(), month: new Set(), year: new Set() },
      });
    }
    const bucket = buckets.get(code)!;

    const periods: Array<'day' | 'month' | 'year'> = ['year'];
    if (at >= monthStart) periods.push('month');
    if (at >= dayStart) periods.push('day');

    for (const period of periods) {
      add(bucket[period], litres.toFixed(3), value, shortage);
      add(overall[period], litres.toFixed(3), value, shortage);

      // A tanker feeding both tanks is one delivery, not two.
      if (!bucket.seen[period]!.has(row.delivery_id)) {
        bucket.seen[period]!.add(row.delivery_id);
        bucket[period].deliveries += 1;
      }
      if (!overallSeen[period]!.has(row.delivery_id)) {
        overallSeen[period]!.add(row.delivery_id);
        overall[period].deliveries += 1;
      }
    }
  }

  return {
    byTank: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tankCode, b]) => ({ tankCode, day: b.day, month: b.month, year: b.year })),
    overall,
  };
}
