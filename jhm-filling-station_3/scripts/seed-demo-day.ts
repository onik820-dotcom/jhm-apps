/**
 * One full trading day, so the reports have something to be right about.
 *
 * A report screen on an empty database proves nothing: every total is zero and
 * every total agrees. This builds a day the way the station works — a tanker
 * in the morning, a day shift and a night shift, credit to three parties, oil
 * off the shelf and into a lorry, expenses out of the drawer — so the report
 * figures can be checked against arithmetic done by hand.
 *
 *   npx tsx scripts/seed-demo-day.ts
 *   npx tsx scripts/seed-demo-day.ts --remove
 *
 * It goes through the real RPCs — the same record_tanker_delivery() and
 * close_shift() the screens call — rather than inserting rows directly. Data
 * that skipped the triggers would tell us the reports work when they only work
 * on data nothing checked.
 *
 * Everything it writes is named DEMO or belongs to a shift on the seeded date.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { indexChart, litresToDip, dipToLitres, type CalibrationChart } from '../lib/calc/dip';
import { dec, litresStr, moneyStr } from '../lib/calc/decimal';

config({ path: '.env.local' });

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const DEMO_DATE = process.env.DEMO_DATE ?? '2026-09-18';

const RATE = '106.25';
const DEPOT_RATE = '102.40';

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in failed for ${email}: ${error.message}`);
  return client;
}

/** Asia/Dhaka is UTC+6 all year, so the offset is fixed. */
function at(time: string, date = DEMO_DATE): string {
  return `${date}T${time}:00+06:00`;
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
}

/**
 * Unwrap a Supabase result, or say loudly which step failed.
 *
 * The client is not generated against a Database type here, so an insert's
 * .select() is typed `never`. The caller states the shape it expects instead
 * of the script pretending it knows.
 */
function must<T>(
  result: { data: unknown; error: { message: string } | null },
  what: string,
): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null || result.data === undefined) {
    throw new Error(`${what}: no data returned`);
  }
  return result.data as T;
}

type Id = { id: string };

async function loadChart(client: SupabaseClient, tankId: string, tankCode: string) {
  // Paged: PostgREST returns at most 1,000 rows and a chart is twice that. An
  // unpaged select does not error, it just hands back half a tank.
  const PAGE = 1000;
  const raw: Array<{ dip_mm: number; litres: string; version: number; valid_from: string; valid_to: string }> = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('tank_calibration')
      .select('dip_mm, litres, version, valid_from, valid_to')
      .eq('tank_id', tankId)
      .order('dip_mm')
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`chart for ${tankCode}: ${error.message}`);
    const page = (data ?? []) as typeof raw;
    raw.push(...page);
    if (page.length < PAGE) break;
  }

  const data = raw;
  const rows = data.map((r) => ({ dipMm: Number(r.dip_mm), litres: String(r.litres) }));
  const chart: CalibrationChart = {
    tankId,
    tankCode,
    version: data[0]?.version ?? 1,
    validFrom: new Date(data[0]?.valid_from ?? '2022-01-31'),
    validTo: new Date(data[0]?.valid_to ?? '2027-01-30'),
    finalDipMm: rows.length > 0 ? rows[rows.length - 1]!.dipMm : 0,
    rows,
  };
  return indexChart(chart);
}

async function main() {
  const admin = await signIn(process.env.SEED_ADMIN_EMAIL!, process.env.SEED_ADMIN_PASSWORD!);

  if (process.argv.includes('--remove')) {
    console.log(
      `Teardown is a privileged hard delete, so it is not done from here.\n` +
        `Remove the demo day with the SQL in docs/demo-day.md, or leave it —\n` +
        `every row is named DEMO or dated ${DEMO_DATE}.`,
    );
    return;
  }

  // Refuse to build on top of a half-built day. Cleaning up is a privileged
  // hard delete this script deliberately cannot do, so it says what to run.
  const existing = must<Array<Id>>(
    await admin.from('shifts').select('id').eq('shift_date', DEMO_DATE),
    'existing shifts',
  );
  if (existing.length > 0) {
    console.error(
      `${DEMO_DATE} already has ${existing.length} shift(s). Remove the demo day first —\n` +
        `the teardown SQL is in docs/demo-day.md — then run this again.`,
    );
    process.exit(1);
  }

  const station = must<Id>(await admin.from('stations').select('id').limit(1).single(), 'station');
  const tanks = must<Array<{ id: string; code: string }>>(
    await admin.from('tanks').select('id, code').order('code'),
    'tanks',
  );
  const nozzleRows = must<Array<{ id: string; nozzle_no: number; dispenser_id: string }>>(
    await admin.from('nozzles').select('id, nozzle_no, dispenser_id').order('nozzle_no'),
    'nozzles',
  );
  const dispensers = must<Array<{ id: string; code: string; tank_id: string }>>(
    await admin.from('dispensers').select('id, code, tank_id').order('code'),
    'dispensers',
  );

  const byCode = new Map(tanks.map((t) => [t.code, t.id]));
  const t1 = byCode.get('T1')!;
  const t2 = byCode.get('T2')!;
  const dispById = new Map(dispensers.map((d) => [d.id, d]));
  const nozzles = nozzleRows
    .map((n) => ({ ...n, disp: dispById.get(n.dispenser_id)! }))
    .sort((a, b) => a.disp.code.localeCompare(b.disp.code));

  const chartT1 = await loadChart(admin, t1, 'T1');
  const chartT2 = await loadChart(admin, t2, 'T2');
  const chartFor = (tankId: string) => (tankId === t1 ? chartT1 : chartT2);

  console.log(`Building the trading day of ${DEMO_DATE}\n`);

  // ---- three credit parties ----------------------------------------------
  const parties: Array<{ id: string; name: string }> = [];
  for (const [name, limit, opening, agedDays, vehicles] of [
    ['DEMO Shah Mamun Transport', '200000', '48500', 45, 'JSR-T-11-2345,JSR-T-11-8890'],
    ['DEMO Jashore Brick Field', '150000', '112000', 95, 'JSR-T-12-7766'],
    ['DEMO Abhaynagar Agro', '80000', '0', 0, 'JSR-T-14-9081'],
  ] as const) {
    const row = must<Id>(
      await admin
        .from('customers')
        .insert({
          station_id: station.id,
          name,
          type: 'company',
          credit_limit: limit,
          opening_balance: opening,
          opening_balance_as_of:
            agedDays > 0
              ? new Date(Date.parse(DEMO_DATE) - agedDays * 864e5).toISOString().slice(0, 10)
              : null,
          is_active: true,
          // A party gets found in the chat by name or by a lorry's plate, so
          // the demo day needs plates to search for.
          vehicle_numbers: vehicles.split(','),
        })
        .select('id')
        .single(),
      `party ${name}`,
    );
    parties.push({ id: row.id, name });
    console.log(`  party    ${name.padEnd(28)} limit ৳${limit}, owing ৳${opening}`);
  }

  // ---- the day shift opens at 06:00 --------------------------------------
  const dayShift = must<Id>(
    await admin
      .from('shifts')
      .insert({
        station_id: station.id,
        shift_date: DEMO_DATE,
        shift_type: 'day',
        starts_at: at('06:00'),
        ends_at: at('18:00'),
        status: 'open',
      })
      .select('id')
      .single(),
    'day shift',
  );

  // Opening dips, before the tanker arrives.
  const openDips: Record<string, string> = { [t1]: '520', [t2]: '610' };
  for (const [tankId, dipMm] of Object.entries(openDips)) {
    must<Id>(
      await admin
        .from('tank_dips')
        .insert({
          shift_id: dayShift.id,
          tank_id: tankId,
          dip_type: 'open',
          dip_mm: dipMm,
          litres: 0,
          recorded_at: at('06:05'),
        })
        .select('id')
        .single(),
      'opening dip',
    );
  }

  // Opening meter readings, one per nozzle.
  const openingReadings: Record<string, string> = {};
  let base = 412500;
  for (const n of nozzles) {
    openingReadings[n.id] = String(base);
    must<Id>(
      await admin
        .from('meter_readings')
        .insert({
          shift_id: dayShift.id,
          nozzle_id: n.id,
          reading_type: 'open',
          reading: openingReadings[n.id],
          // meter_readings has no recorded_at: the time a reading belongs to
          // is the shift's, and created_at carries when it was entered.
          confirmed_at: at('06:05'),
        })
        .select('id')
        .single(),
      'opening reading',
    );
    base += 38000;
  }
  console.log(`  shift    day opened — T1 dip 520 mm, T2 dip 610 mm`);

  // ---- the tanker, 07:40 --------------------------------------------------
  //
  // The dips are computed from the litres each compartment actually gave up,
  // not guessed: a dip typed by hand would have to be re-guessed every time
  // the opening stock changed, and a compartment that overshot the tank's
  // certified range would be rejected for reasons that had nothing to do with
  // what the test was for. Two compartments come up short, which is ordinary.
  const shortages = [2, 38, 0, 1];
  const compartments: Array<Record<string, string | number>> = [];
  const runningDip: Record<string, number> = { [t1]: 520, [t2]: 610 };

  [t1, t1, t2, t2].forEach((tankId, index) => {
    const chart = chartFor(tankId);
    const before = runningDip[tankId]!;
    const received = 4500 - shortages[index]!;
    const after = litresToDip(chart, litresStr(dipToLitres(chart, before).plus(received)))
      .toDecimalPlaces(0)
      .toNumber();
    compartments.push({
      compartment_no: index + 1,
      declared_litres: '4500',
      tank_id: tankId,
      dip_before_mm: String(before),
      dip_after_mm: String(after),
    });
    runningDip[tankId] = after;
  });

  const deliveryResult = must<DeliveryResult>(
    await admin.rpc('record_tanker_delivery', {
      p_payload: {
        challan_no: 'DEMO-CH-88120',
        truck_reg: 'DHAKA METRO-T-11-4590',
        driver_name: 'Demo Driver',
        depot_rate: DEPOT_RATE,
        arrived_at: at('07:40'),
        compartments,
      },
    }),
    'delivery',
  );
  console.log(
    `  tanker   DEMO-CH-88120 — ${deliveryResult.totals.received} L received, ` +
      `${deliveryResult.totals.shortage} L short, at ৳${DEPOT_RATE}/L`,
  );

  // ---- close the day shift -----------------------------------------------
  // Litres sold per nozzle, chosen so the two tanks move by realistic amounts.
  const daySold: Record<string, number> = {};
  nozzles.forEach((n, i) => {
    daySold[n.id] = [1420, 980, 1650, 1130][i] ?? 1000;
  });

  const dayClose = await closeShift(admin, {
    shiftId: dayShift.id,
    openingReadings,
    sold: daySold,
    testLitres: { [nozzles[0]!.id]: 5 },
    openDipLitres: {
      [t1]: dipToLitres(chartT1, openDips[t1]!).toString(),
      [t2]: dipToLitres(chartT2, openDips[t2]!).toString(),
    },
    received: { [t1]: deliveryResult.tanks.find((x: { tank_code: string }) => x.tank_code === 'T1')?.received_litres ?? '0',
                [t2]: deliveryResult.tanks.find((x: { tank_code: string }) => x.tank_code === 'T2')?.received_litres ?? '0' },
    nozzles,
    chartFor,
    tankIds: [t1, t2],
    // A small, believable loss on T1 and a clean T2.
    varianceLitres: { [t1]: -4, [t2]: 0 },
    rate: RATE,
    creditSales: [
      { customer_id: parties[0]!.id, litres: '180.000', rate: RATE, amount: '19125.00', vehicle_no: 'JSR-T-11-2345', challan_no: 'DEMO-S-001' },
      { customer_id: parties[2]!.id, litres: '95.000', rate: RATE, amount: '10093.75', vehicle_no: 'JSR-T-14-9081', challan_no: 'DEMO-S-002' },
    ],
    expenses: [
      { category_id: await categoryId(admin, 'Staff Food & Tiffin'), amount: '850.00', description: 'DEMO day shift tiffin', paid_by: 'cash' },
      { category_id: await categoryId(admin, 'Electricity Bill'), amount: '6400.00', description: 'DEMO September bill', paid_by: 'bank' },
    ],
    cash: { opening_cash: '12000', bank_deposits: '100000', counted_cash: null },
  });
  console.log(
    `  close    day — ${dayClose.sales.net_litres} L net at ৳${RATE}, ` +
      `৳${dayClose.sales.total_sales} sold, cash ৳${dayClose.cash.counted_cash}`,
  );

  // ---- the night shift ----------------------------------------------------
  const nightShift = must<Id>(
    await admin
      .from('shifts')
      .insert({
        station_id: station.id,
        shift_date: DEMO_DATE,
        shift_type: 'night',
        starts_at: at('18:00'),
        ends_at: at('06:00', nextDay(DEMO_DATE)),
        status: 'open',
      })
      .select('id')
      .single(),
    'night shift',
  );

  // A collection from a party during the night, in cash — this is what the
  // drawer will count as dues, and it is why the figure is not typed.
  must<Id>(
    await admin
      .from('payments')
      .insert({
        customer_id: parties[1]!.id,
        amount: '25000.00',
        method: 'cash',
        shift_id: nightShift.id,
        reference: 'DEMO-RCPT-4471',
        received_at: at('21:30'),
      })
      .select('id')
      .single(),
    'payment',
  );

  // Oil sold, and oil into the station's own lorry.
  const sku = must<{ id: string; name: string }>(
    await admin.from('lub_skus').select('id, name').eq('name', 'Engine Oil — Loose').single(),
    'sku',
  );
  must<Id>(
    await admin
      .from('lub_transactions')
      .insert({ sku_id: sku.id, txn_type: 'purchase', qty: '40.000', rate: '486.00', amount: 0, shift_id: nightShift.id, txn_at: at('19:00') })
      .select('id')
      .single(),
    'lub purchase',
  );
  must<Id>(
    await admin
      .from('lub_transactions')
      .insert({ sku_id: sku.id, txn_type: 'sale', qty: '12.000', rate: '620.00', amount: 0, shift_id: nightShift.id, txn_at: at('20:15') })
      .select('id')
      .single(),
    'lub sale',
  );
  must<Id>(
    await admin
      .from('lub_transactions')
      .insert({ sku_id: sku.id, txn_type: 'own_use', qty: '3.000', rate: 0, amount: 0, shift_id: nightShift.id, vehicle_ref: 'DEMO-LORRY-1', txn_at: at('22:40') })
      .select('id')
      .single(),
    'lub own use',
  );

  const nightSold: Record<string, number> = {};
  nozzles.forEach((n, i) => {
    nightSold[n.id] = [860, 610, 1040, 720][i] ?? 700;
  });

  const nightClose = await closeShift(admin, {
    shiftId: nightShift.id,
    openingReadings: Object.fromEntries(
      nozzles.map((n) => [n.id, String(Number(openingReadings[n.id]) + daySold[n.id]!)]),
    ),
    sold: nightSold,
    testLitres: {},
    openDipLitres: {},
    received: {},
    nozzles,
    chartFor,
    tankIds: [t1, t2],
    varianceLitres: { [t1]: 0, [t2]: -11 },
    rate: RATE,
    creditSales: [
      { customer_id: parties[1]!.id, litres: '240.000', rate: RATE, amount: '25500.00', vehicle_no: 'JSR-T-12-7766', challan_no: 'DEMO-S-003' },
    ],
    expenses: [
      { category_id: await categoryId(admin, 'Cleaning & Washing'), amount: '400.00', description: 'DEMO forecourt wash', paid_by: 'cash' },
      { category_id: await categoryId(admin, 'Chairman Personal'), amount: '15000.00', description: 'DEMO chairman drawing', paid_by: 'cash' },
    ],
    cash: { opening_cash: null, bank_deposits: '0', counted_cash: null },
  });
  console.log(
    `  close    night — ${nightClose.sales.net_litres} L net, ` +
      `৳${nightClose.sales.total_sales} sold, cash ৳${nightClose.cash.counted_cash}`,
  );

  console.log(`\nDone. ${DEMO_DATE} now has two closed shifts, a tanker, three parties,`);
  console.log(`lubricant movement including own use, and both expense books.`);
}

async function categoryId(client: SupabaseClient, name: string): Promise<string> {
  const row = must<Id>(
    await client.from('expense_categories').select('id').eq('name', name).single(),
    `category ${name}`,
  );
  return row.id;
}

interface DeliveryResult {
  totals: { received: string; shortage: string };
  tanks: Array<{ tank_code: string; received_litres: string }>;
}

interface ClosePreview {
  sales: { net_litres: string; total_sales: string };
  cash: { expected_cash: string; counted_cash: string };
  tanks: Array<{ tank_id: string; variance_flagged: boolean }>;
}

interface CloseInput {
  shiftId: string;
  openingReadings: Record<string, string>;
  sold: Record<string, number>;
  testLitres: Record<string, number>;
  openDipLitres: Record<string, string>;
  received: Record<string, string>;
  nozzles: Array<{ id: string; disp: { code: string; tank_id: string } }>;
  chartFor: (tankId: string) => ReturnType<typeof indexChart>;
  tankIds: string[];
  varianceLitres: Record<string, number>;
  rate: string;
  creditSales: Array<Record<string, string>>;
  expenses: Array<Record<string, string>>;
  cash: { opening_cash: string | null; bank_deposits: string; counted_cash: string | null };
}

/**
 * Work out the closing dip that produces the variance we asked for, then close
 * through the real RPC.
 *
 * The book closing is opening + received − sold from that tank. Adding the
 * intended variance gives the physical stock, and the chart turns that back
 * into the dip the rod would have shown. Doing it this way means the shift
 * closes with a variance we chose rather than one we discovered, which is what
 * makes it useful for testing the variance paths.
 */
async function closeShift(client: SupabaseClient, input: CloseInput) {
  // Book opening per tank: the previous close, or the opening dip on day one.
  const bookOpening: Record<string, string> = {};
  for (const tankId of input.tankIds) {
    if (input.openDipLitres[tankId]) {
      bookOpening[tankId] = input.openDipLitres[tankId]!;
      continue;
    }
    const { data } = await client
      .from('shift_stock')
      .select('book_closing, shifts!inner(starts_at)')
      .eq('tank_id', tankId)
      .order('shifts(starts_at)', { ascending: false })
      .limit(1);
    const previous = data as Array<{ book_closing: number | string }> | null;
    bookOpening[tankId] = String(previous?.[0]?.book_closing ?? 0);
  }

  const soldPerTank: Record<string, number> = {};
  for (const n of input.nozzles) {
    const net = (input.sold[n.id] ?? 0) - (input.testLitres[n.id] ?? 0);
    soldPerTank[n.disp.tank_id] = (soldPerTank[n.disp.tank_id] ?? 0) + net;
  }

  const dips: Array<{ tank_id: string; dip_mm: string }> = [];
  for (const tankId of input.tankIds) {
    const book = dec(bookOpening[tankId]!)
      .plus(dec(input.received[tankId] ?? '0'))
      .minus(dec(soldPerTank[tankId] ?? 0));
    const physical = book.plus(dec(input.varianceLitres[tankId] ?? 0));
    const dipMm = litresToDip(input.chartFor(tankId), litresStr(physical));
    dips.push({ tank_id: tankId, dip_mm: dipMm.toDecimalPlaces(0).toString() });
  }

  const readings = input.nozzles.map((n) => ({
    nozzle_id: n.id,
    closing: String(Number(input.openingReadings[n.id]) + (input.sold[n.id] ?? 0)),
    test_litres: String(input.testLitres[n.id] ?? 0),
  }));

  const basePayload = {
    rate_per_litre: input.rate,
    readings,
    dips,
    credit_sales: input.creditSales,
    lubricant_sales: [],
    expenses: input.expenses,
    cash: {
      opening_cash: input.cash.opening_cash ?? '0',
      bank_deposits: input.cash.bank_deposits,
      counted_cash: '0',
    },
    variance_reasons: {} as Record<string, string>,
    cash_variance_reason: 'DEMO — seeded day',
  };

  // Ask the database what it makes of this, so the counted cash can be set to
  // whatever balances and the variance reasons can be supplied for exactly the
  // tanks it flags. This is the same preview the wizard shows.
  const preview = must<ClosePreview>(
    await client.rpc('compute_shift_close', { p_shift_id: input.shiftId, p_payload: basePayload }),
    'close preview',
  );

  for (const tank of preview.tanks) {
    if (tank.variance_flagged) {
      basePayload.variance_reasons[tank.tank_id] =
        'DEMO — seeded variance for testing the report paths';
    }
  }
  basePayload.cash.counted_cash = moneyStr(preview.cash.expected_cash);

  return must<ClosePreview>(
    await client.rpc('close_shift', { p_shift_id: input.shiftId, p_payload: basePayload }),
    'close',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
