import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { D, dec, decOr0 } from '@/lib/calc/decimal';
import { CHART_EXPIRY_WARNING_DAYS } from '@/lib/calc/dip';

export interface TankDetail {
  id: string;
  code: string;
  product: string;
  status: 'active' | 'paused' | 'removed';
  capacityLitres: string;

  /** Certified metadata. Null when a tank has been added but not yet calibrated. */
  finalDipMm: number | null;
  lengthMm: number | null;
  diameterMm: number | null;
  grossHeightMm: number | null;
  dipPipeLengthMm: number | null;
  calibratedBy: string | null;
  calibrationOffice: string | null;
  calibrationDate: string | null;
  previousCalibration: string | null;
  validityFrom: string | null;
  validityTo: string | null;
  certificateImageUrl: string | null;

  chartVersion: number | null;
  calibrationRows: number;
  chartDaysRemaining: number | null;
  chartExpired: boolean;
  chartExpiringSoon: boolean;

  lastDipMm: string | null;
  lastDipLitres: string | null;
  lastDipAt: string | null;
  fillPct: number | null;
  ullageLitres: string | null;

  /** Admin and MD only — RLS returns nothing on tank_cost_history to a manager. */
  avgCost: string | null;
  stockValue: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function getTankDetails(): Promise<TankDetail[]> {
  const supabase = await createClient();

  const { data: tanks, error } = await supabase
    .from('tanks')
    .select(
      'id, code, product, status, capacity_litres, ' +
        'tank_metadata(final_dip_mm, length_mm, diameter_mm, gross_height_mm, dip_pipe_length_mm, ' +
        'calibrated_by, calibration_office, calibration_date, previous_calibration, ' +
        'validity_from, validity_to, certificate_image_url)',
    )
    .is('deleted_at', null)
    .order('code');

  if (error || !tanks) return [];

  const now = Date.now();

  return Promise.all(
    (tanks as unknown as RawTank[]).map(async (tank) => {
      const meta = tank.tank_metadata?.[0] ?? null;

      const [dipResult, chartResult, costResult] = await Promise.all([
        supabase
          .from('tank_dips')
          .select('dip_mm, litres, recorded_at, calibration_version')
          .eq('tank_id', tank.id)
          .is('deleted_at', null)
          .order('recorded_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('tank_calibration')
          .select('version', { count: 'exact' })
          .eq('tank_id', tank.id)
          .order('version', { ascending: false })
          .limit(1),
        supabase
          .from('tank_cost_history')
          .select('avg_cost')
          .eq('tank_id', tank.id)
          .order('effective_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const dip = dipResult.data;
      const capacity = dec(tank.capacity_litres);
      const litres = dip ? dec(dip.litres) : null;
      const avgCost = costResult.data ? dec(costResult.data.avg_cost) : null;

      const daysRemaining = meta?.validity_to
        ? Math.floor((new Date(`${meta.validity_to}T23:59:59+06:00`).getTime() - now) / MS_PER_DAY)
        : null;

      return {
        id: tank.id,
        code: tank.code,
        product: tank.product,
        status: tank.status,
        capacityLitres: capacity.toFixed(3),

        finalDipMm: meta?.final_dip_mm ?? null,
        lengthMm: meta?.length_mm ?? null,
        diameterMm: meta?.diameter_mm ?? null,
        grossHeightMm: meta?.gross_height_mm ?? null,
        dipPipeLengthMm: meta?.dip_pipe_length_mm ?? null,
        calibratedBy: meta?.calibrated_by ?? null,
        calibrationOffice: meta?.calibration_office ?? null,
        calibrationDate: meta?.calibration_date ?? null,
        previousCalibration: meta?.previous_calibration ?? null,
        validityFrom: meta?.validity_from ?? null,
        validityTo: meta?.validity_to ?? null,
        certificateImageUrl: meta?.certificate_image_url ?? null,

        chartVersion: chartResult.data?.[0]?.version ?? null,
        calibrationRows: chartResult.count ?? 0,
        chartDaysRemaining: daysRemaining,
        chartExpired: daysRemaining !== null && daysRemaining < 0,
        chartExpiringSoon: daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= CHART_EXPIRY_WARNING_DAYS,

        lastDipMm: dip ? dec(dip.dip_mm).toString() : null,
        lastDipLitres: litres ? litres.toFixed(3) : null,
        lastDipAt: dip?.recorded_at ?? null,
        fillPct:
          litres && !capacity.isZero()
            ? Number(litres.dividedBy(capacity).times(100).toDecimalPlaces(1, D.ROUND_HALF_UP))
            : null,
        ullageLitres: litres ? capacity.minus(litres).toFixed(3) : null,

        avgCost: avgCost ? avgCost.toFixed(4) : null,
        stockValue: avgCost && litres ? litres.times(avgCost).toDecimalPlaces(2).toFixed(2) : null,
      } satisfies TankDetail;
    }),
  );
}

interface RawTank {
  id: string;
  code: string;
  product: string;
  status: TankDetail['status'];
  capacity_litres: string;
  tank_metadata: Array<{
    final_dip_mm: number;
    length_mm: number | null;
    diameter_mm: number | null;
    gross_height_mm: number | null;
    dip_pipe_length_mm: number | null;
    calibrated_by: string | null;
    calibration_office: string | null;
    calibration_date: string | null;
    previous_calibration: string | null;
    validity_from: string;
    validity_to: string;
    certificate_image_url: string | null;
  }> | null;
}

export async function getTankDetail(tankId: string): Promise<TankDetail | null> {
  const all = await getTankDetails();
  return all.find((t) => t.id === tankId) ?? null;
}

export interface CalibrationRow {
  dipMm: number;
  litres: string;
  /** Litres added by this millimetre — how much one millimetre is worth here. */
  stepLitres: string | null;
}

export interface CalibrationPage {
  rows: CalibrationRow[];
  total: number;
  from: number;
  to: number;
}

/**
 * A window of the certified chart, for the searchable table. The step column is
 * what makes the chart readable: it shows that a millimetre is worth 4 L near
 * the bottom of the tank and 8 L in the middle, which is why a dip read to the
 * nearest millimetre still carries a few litres of uncertainty.
 */
export async function getCalibrationPage(
  tankId: string,
  version: number,
  fromDip: number,
  toDip: number,
): Promise<CalibrationPage> {
  const supabase = await createClient();

  // One row before the window so the first step can be computed. The total is
  // counted separately — counting within the window would report the size of
  // the page rather than the size of the chart.
  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from('tank_calibration')
      .select('dip_mm, litres')
      .eq('tank_id', tankId)
      .eq('version', version)
      .gte('dip_mm', Math.max(1, fromDip - 1))
      .lte('dip_mm', toDip)
      .order('dip_mm'),
    supabase
      .from('tank_calibration')
      .select('id', { count: 'exact', head: true })
      .eq('tank_id', tankId)
      .eq('version', version),
  ]);

  if (error || !data) return { rows: [], total: count ?? 0, from: fromDip, to: toDip };

  const rows: CalibrationRow[] = [];
  let previous: string | null = null;

  for (const row of data as Array<{ dip_mm: number; litres: string }>) {
    if (row.dip_mm >= fromDip) {
      rows.push({
        dipMm: row.dip_mm,
        litres: dec(row.litres).toFixed(3),
        stepLitres: previous === null ? null : dec(row.litres).minus(dec(previous)).toFixed(3),
      });
    }
    previous = row.litres;
  }

  return { rows, total: count ?? 0, from: fromDip, to: toDip };
}

export interface CurvePoint {
  dipMm: number;
  litres: number;
}

/**
 * The chart as a curve. Sampled rather than complete — 2,070 points is more
 * than a line chart can usefully draw — but the endpoints are always included
 * so the curve really does finish at the tank's own final dip.
 */
export async function getCalibrationCurve(tankId: string, version: number, step = 10): Promise<CurvePoint[]> {
  const supabase = await createClient();

  // PostgREST caps a response at 1,000 rows, and a chart is twice that. Asking
  // for the whole chart in one select does not fail — it quietly returns the
  // first 1,000 rows, which drew a curve that stopped at 1000 mm / 5,163 L and
  // labelled that as the top of a 12,000 L tank. The rows have to be paged.
  const PAGE = 1000;
  const rows: Array<{ dip_mm: number; litres: string }> = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('tank_calibration')
      .select('dip_mm, litres')
      .eq('tank_id', tankId)
      .eq('version', version)
      .order('dip_mm')
      .range(from, from + PAGE - 1);

    if (error) return [];
    const page = (data ?? []) as Array<{ dip_mm: number; litres: string }>;
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  if (rows.length === 0) return [];
  const points: CurvePoint[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (i === 0 || i === rows.length - 1 || row.dip_mm % step === 0) {
      points.push({ dipMm: row.dip_mm, litres: Number(dec(row.litres)) });
    }
  }
  return points;
}

export interface DispenserDetail {
  id: string;
  code: string;
  tankId: string;
  tankCode: string;
  status: 'active' | 'paused' | 'removed';
  nozzleCount: number;
  meterDigits: number;
  maxFlowLpm: string;
  installedAt: string | null;
}

export async function getDispenserDetails(): Promise<DispenserDetail[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('dispensers')
    .select('id, code, status, nozzle_count, meter_digits, max_flow_lpm, installed_at, tank_id, tanks(code)')
    .is('deleted_at', null)
    .order('code');

  if (error || !data) return [];

  return (data as unknown as Array<{
    id: string;
    code: string;
    status: DispenserDetail['status'];
    nozzle_count: number;
    meter_digits: number;
    max_flow_lpm: string;
    installed_at: string | null;
    tank_id: string;
    tanks: { code: string } | null;
  }>).map((row) => ({
    id: row.id,
    code: row.code,
    tankId: row.tank_id,
    tankCode: row.tanks?.code ?? '—',
    status: row.status,
    nozzleCount: row.nozzle_count,
    meterDigits: row.meter_digits,
    maxFlowLpm: decOr0(row.max_flow_lpm).toFixed(2),
    installedAt: row.installed_at,
  }));
}
