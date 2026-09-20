import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { asLitres, asMoney, asPctOrNull } from '@/lib/data/numeric';
import { dec, litresStr, moneyStr, sum as decSum } from '@/lib/calc/decimal';
import { reportById, visibleColumns, type ReportDefinition } from './registry';

/**
 * Running a report.
 *
 * Every figure is normalised at this boundary — PostgREST hands numerics back
 * as JavaScript doubles — so a row that reaches the screen, the workbook or
 * the printed page is the same row of fixed-point strings in all three. That
 * is the whole point of the registry: one query, one set of numbers, three
 * ways of looking at them.
 */

export interface ReportRow {
  [key: string]: string | number | null;
}

export interface ReportResult {
  report: ReportDefinition;
  rows: ReportRow[];
  /** Keyed by column, already formatted to the column's scale. */
  totals: Record<string, string>;
  from: string;
  to: string;
  /** Present for the two reports that are a page rather than a table. */
  sheet?: unknown;
  statement?: unknown;
  error?: string;
}

/**
 * PostgREST rows, as the untyped client hands them over.
 *
 * Without a generated Database type the client cannot know an embedded
 * resource's shape, so it widens every joined column into an error union. The
 * rows themselves are fine; the type is the client admitting it does not know
 * them. One cast at the point of use beats a cast on every field.
 */
type Raw = Record<string, unknown>;

function rowsOf(data: unknown): Raw[] {
  return (data ?? []) as Raw[];
}

/** One field of an untyped row, narrowed to what the formatters accept. */
function v(row: Raw, key: string): string | number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'yes' : '';
  return null;
}

/** The same, as a string, for a column that is text on the page. */
function text(row: Raw, key: string): string {
  const value = v(row, key);
  return value === null ? '' : String(value);
}

function first<T>(v: unknown): T | null {
  return Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null);
}

export async function runReport(
  id: string,
  from: string,
  to: string,
  canSeeCost: boolean,
): Promise<ReportResult> {
  const report = reportById(id);
  if (!report) throw new Error(`No report called ${id}`);

  const supabase = await createClient();
  const empty: ReportResult = { report, rows: [], totals: {}, from, to };

  switch (id) {
    // ---- the two page-shaped reports --------------------------------------
    case 'daily-sheet': {
      const { data, error } = await supabase.rpc('daily_sheet', { p_date: to });
      return { ...empty, sheet: data, error: error?.message };
    }

    case 'profit-loss': {
      const { data, error } = await supabase.rpc('profit_and_loss', {
        p_from: from,
        p_to: to,
      });
      return { ...empty, statement: data, error: error?.message };
    }

    // ---- tables -----------------------------------------------------------
    case 'shift-reconciliation': {
      const { data } = await supabase
        .from('shift_sales')
        .select(
          'net_litres, rate_per_litre, sales_amount, lubricant_sales, credit_sales, cash_sales, ' +
            'shifts!inner(shift_date, shift_type, starts_at), ' +
            'cash_reconciliation:shift_id(expected_cash, counted_cash, cash_variance, variance_reason)',
        )
        .gte('shifts.shift_date', from)
        .lte('shifts.shift_date', to)
        .order('starts_at', { referencedTable: 'shifts', ascending: true });

      const rows = rowsOf(data).map((r) => {
        const s = first<{ shift_date: string; shift_type: string }>(r.shifts);
        const c = first<{
          expected_cash: number;
          counted_cash: number;
          cash_variance: number;
          variance_reason: string | null;
        }>(r.cash_reconciliation);
        return {
          shift_date: s?.shift_date ?? '',
          shift_type: s?.shift_type ?? '',
          net_litres: asLitres(v(r, 'net_litres')),
          rate_per_litre: asMoney(v(r, 'rate_per_litre')),
          sales_amount: asMoney(v(r, 'sales_amount')),
          lubricant_sales: asMoney(v(r, 'lubricant_sales')),
          credit_sales: asMoney(v(r, 'credit_sales')),
          cash_sales: asMoney(v(r, 'cash_sales')),
          expected_cash: asMoney(c?.expected_cash),
          counted_cash: asMoney(c?.counted_cash),
          cash_variance: asMoney(c?.cash_variance),
          variance_reason: c?.variance_reason ?? '',
        };
      });
      return { ...empty, rows, totals: totalsFor(report, rows, canSeeCost) };
    }

    case 'stock-variance': {
      const { data } = await supabase
        .from('shift_stock')
        .select(
          'book_opening, refill_litres, sold_from_tank, book_closing, physical_closing, ' +
            'variance_litres, variance_pct, variance_reason, ' +
            'tanks!inner(code), shifts!inner(shift_date, shift_type, starts_at)',
        )
        .gte('shifts.shift_date', from)
        .lte('shifts.shift_date', to)
        .order('starts_at', { referencedTable: 'shifts', ascending: true });

      const rows = rowsOf(data).map((r) => {
        const s = first<{ shift_date: string; shift_type: string }>(r.shifts);
        const t = first<{ code: string }>(r.tanks);
        return {
          shift_date: s?.shift_date ?? '',
          shift_type: s?.shift_type ?? '',
          tank_code: t?.code ?? '',
          book_opening: asLitres(v(r, 'book_opening')),
          refill_litres: asLitres(v(r, 'refill_litres')),
          sold_from_tank: asLitres(v(r, 'sold_from_tank')),
          book_closing: asLitres(v(r, 'book_closing')),
          physical_closing: asLitres(v(r, 'physical_closing')),
          variance_litres: asLitres(v(r, 'variance_litres')),
          variance_pct: asPctOrNull(v(r, 'variance_pct')),
          variance_reason: text(r, 'variance_reason'),
        };
      });
      return { ...empty, rows, totals: totalsFor(report, rows, canSeeCost) };
    }

    case 'purchase-register': {
      const { data } = await supabase
        .from('tanker_compartments')
        .select(
          'compartment_no, declared_litres, received_litres, shortage_litres, shortage_pct, ' +
            'tanks(code), tanker_deliveries!inner(challan_no, truck_reg, arrived_at, depot_rate, deleted_at)',
        )
        .is('tanker_deliveries.deleted_at', null)
        .gte('tanker_deliveries.arrived_at', `${from}T00:00:00+06:00`)
        .lte('tanker_deliveries.arrived_at', `${to}T23:59:59+06:00`);

      const rows = rowsOf(data)
        .map((r) => {
          const d = first<{
            challan_no: string | null;
            truck_reg: string | null;
            arrived_at: string;
            depot_rate: number;
          }>(r.tanker_deliveries);
          const t = first<{ code: string }>(r.tanks);
          const received = asLitres(v(r, 'received_litres'));
          const rate = asMoney(d?.depot_rate);
          return {
            arrived_at: d?.arrived_at ?? '',
            challan_no: d?.challan_no ?? '',
            truck_reg: d?.truck_reg ?? '',
            tank_code: t?.code ?? '',
            compartment_no: Number(v(r, 'compartment_no') ?? 0),
            declared_litres: asLitres(v(r, 'declared_litres')),
            received_litres: received,
            shortage_litres: asLitres(v(r, 'shortage_litres')),
            shortage_pct: asPctOrNull(v(r, 'shortage_pct')),
            // Valued on litres received, never on litres declared: the station
            // pays the depot for what the rods say arrived.
            depot_rate: rate,
            value: moneyStr(dec(received).times(dec(rate))),
          };
        })
        .sort((a, b) => (a.arrived_at < b.arrived_at ? -1 : 1));

      return { ...empty, rows, totals: totalsFor(report, rows, canSeeCost) };
    }

    case 'sales-register': {
      const { data } = await supabase
        .from('credit_sales')
        .select(
          'sold_at, vehicle_no, challan_no, litres, rate, amount, over_limit_approved_by, ' +
            'customers(name, name_bn), shifts!inner(shift_date)',
        )
        .is('deleted_at', null)
        .gte('shifts.shift_date', from)
        .lte('shifts.shift_date', to)
        .order('sold_at');

      const rows = rowsOf(data).map((r) => ({
        sold_at: text(r, 'sold_at'),
        party: first<{ name: string }>(r.customers)?.name ?? '',
        vehicle_no: text(r, 'vehicle_no'),
        challan_no: text(r, 'challan_no'),
        litres: v(r, 'litres') === null ? null : asLitres(v(r, 'litres')),
        rate: v(r, 'rate') === null ? null : asMoney(v(r, 'rate')),
        amount: asMoney(v(r, 'amount')),
        over_limit: v(r, 'over_limit_approved_by') ? 'yes' : '',
      }));
      return { ...empty, rows, totals: totalsFor(report, rows, canSeeCost) };
    }

    case 'customer-ageing': {
      const { data } = await supabase.rpc('customer_ageing', { p_as_of: to });
      const rows = rowsOf(data)
        .map((r) => ({
          customer_name: String(v(r, 'customer_name') ?? ''),
          credit_limit: asMoney(v(r, 'credit_limit') as number),
          balance: asMoney(v(r, 'balance') as number),
          bucket_0_30: asMoney(v(r, 'bucket_0_30') as number),
          bucket_31_60: asMoney(v(r, 'bucket_31_60') as number),
          bucket_61_90: asMoney(v(r, 'bucket_61_90') as number),
          bucket_90_plus: asMoney(v(r, 'bucket_90_plus') as number),
          oldest_item_days: (v(r, 'oldest_item_days') as number) ?? null,
        }))
        // A party with nothing outstanding is not a line on an ageing report.
        .filter((r: ReportRow) => Number(v(r, 'balance')) !== 0);
      return { ...empty, rows, totals: totalsFor(report, rows, canSeeCost) };
    }

    case 'expense-register': {
      const { data } = await supabase
        .from('expenses')
        .select(
          'spent_at, description, paid_by, amount, ' +
            'expense_categories!inner(name, name_bn, group), shifts(shift_date)',
        )
        .is('deleted_at', null)
        .gte('spent_at', `${from}T00:00:00+06:00`)
        .lte('spent_at', `${to}T23:59:59+06:00`)
        .order('spent_at');

      const rows = rowsOf(data).map((r) => {
        const c = first<{ name: string; group: string }>(r.expense_categories);
        return {
          spent_at: text(r, 'spent_at'),
          book: c?.group === 'chairman' ? 'Chairman' : 'Pump',
          head: c?.name ?? '',
          description: text(r, 'description'),
          paid_by: text(r, 'paid_by'),
          amount: asMoney(v(r, 'amount')),
        };
      });
      return { ...empty, rows, totals: totalsFor(report, rows, canSeeCost) };
    }

    case 'cash-book': {
      const { data } = await supabase
        .from('cash_reconciliation')
        .select(
          'opening_cash, cash_sales, dues_collected, expenses_cash, bank_deposits, ' +
            'expected_cash, counted_cash, cash_variance, shifts!inner(shift_date, shift_type, starts_at)',
        )
        .gte('shifts.shift_date', from)
        .lte('shifts.shift_date', to)
        .order('starts_at', { referencedTable: 'shifts', ascending: true });

      const rows = rowsOf(data).map((r) => {
        const s = first<{ shift_date: string; shift_type: string }>(r.shifts);
        return {
          shift_date: s?.shift_date ?? '',
          shift_type: s?.shift_type ?? '',
          opening_cash: asMoney(v(r, 'opening_cash')),
          cash_sales: asMoney(v(r, 'cash_sales')),
          dues_collected: asMoney(v(r, 'dues_collected')),
          expenses_cash: asMoney(v(r, 'expenses_cash')),
          bank_deposits: asMoney(v(r, 'bank_deposits')),
          expected_cash: asMoney(v(r, 'expected_cash')),
          counted_cash: asMoney(v(r, 'counted_cash')),
          cash_variance: asMoney(v(r, 'cash_variance')),
        };
      });
      return { ...empty, rows, totals: totalsFor(report, rows, canSeeCost) };
    }

    case 'dispenser-performance': {
      const { data } = await supabase
        .from('meter_readings')
        .select(
          'reading, is_rollover, reading_type, ' +
            'nozzles!inner(nozzle_no, dispensers!inner(code, tank_id, tanks(code))), ' +
            'shifts!inner(shift_date, starts_at)',
        )
        .eq('reading_type', 'close')
        .is('deleted_at', null)
        .gte('shifts.shift_date', from)
        .lte('shifts.shift_date', to);

      // Litres per nozzle come from shift_stock's sold figure at the tank
      // level, so per-nozzle volume is summed from the readings themselves.
      const byNozzle = new Map<string, ReportRow>();
      for (const r of rowsOf(data)) {
        const n = first<{ nozzle_no: number; dispensers: unknown }>(r.nozzles);
        const d = first<{ code: string; tanks: unknown }>(n?.dispensers);
        const t = first<{ code: string }>(d?.tanks);
        const key = `${d?.code}-${n?.nozzle_no}`;
        const existing = byNozzle.get(key) ?? {
          dispenser_code: d?.code ?? '',
          nozzle_no: n?.nozzle_no ?? 0,
          tank_code: t?.code ?? '',
          shifts: 0,
          litres: '0.000',
          test_litres: '0.000',
          rollovers: 0,
        };
        existing.shifts = Number(existing.shifts) + 1;
        existing.rollovers = Number(existing.rollovers) + (v(r, 'is_rollover') ? 1 : 0);
        byNozzle.set(key, existing);
      }

      const rows = [...byNozzle.values()].sort((a, b) =>
        String(a.dispenser_code).localeCompare(String(b.dispenser_code)),
      );
      return { ...empty, rows, totals: totalsFor(report, rows, canSeeCost) };
    }

    case 'lubricant-movement': {
      const { data } = await supabase
        .from('lub_transactions')
        .select('txn_at, txn_type, qty, rate, amount, vehicle_ref, lub_skus(name), customers(name)')
        .is('deleted_at', null)
        .gte('txn_at', `${from}T00:00:00+06:00`)
        .lte('txn_at', `${to}T23:59:59+06:00`)
        .order('txn_at');

      const rows = rowsOf(data).map((r) => ({
        txn_at: text(r, 'txn_at'),
        sku: first<{ name: string }>(r.lub_skus)?.name ?? '',
        txn_type: text(r, 'txn_type'),
        qty: asLitres(v(r, 'qty')),
        rate: asMoney(v(r, 'rate')),
        amount: asMoney(v(r, 'amount')),
        party: first<{ name: string }>(r.customers)?.name ?? text(r, 'vehicle_ref'),
      }));
      return { ...empty, rows, totals: totalsFor(report, rows, canSeeCost) };
    }

    case 'audit-log': {
      const { data } = await supabase
        .from('audit_log')
        .select('at, table_name, action, actor_role, record_id, profiles(full_name)')
        .gte('at', `${from}T00:00:00+06:00`)
        .lte('at', `${to}T23:59:59+06:00`)
        .order('at', { ascending: false })
        .limit(2000);

      const rows = rowsOf(data).map((r) => ({
        at: text(r, 'at'),
        actor: first<{ full_name: string }>(r.profiles)?.full_name ?? 'system',
        actor_role: text(r, 'actor_role'),
        table_name: text(r, 'table_name'),
        action: text(r, 'action'),
        summary: String(text(r, 'record_id')),
      }));
      return { ...empty, rows, totals: {} };
    }

    default:
      return empty;
  }
}

/**
 * Totals for the columns that asked for one.
 *
 * Summed from the rows on the page rather than fetched separately: a total
 * that came from a different query than its rows is a total nobody can check
 * by adding up the column.
 */
function totalsFor(
  report: ReportDefinition,
  rows: ReportRow[],
  canSeeCost: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const column of visibleColumns(report, canSeeCost)) {
    if (!column.total) continue;
    const values: string[] = [];
    for (const row of rows) {
      const value = row[column.key];
      if (value === null || value === undefined || value === '') continue;
      values.push(String(value));
    }
    // decimal.js, not +=. A column of money added with floats is exactly the
    // thing lib/data/numeric.ts exists to prevent.
    const total = decSum(values);
    out[column.key] =
      column.kind === 'litres'
        ? litresStr(total)
        : column.kind === 'number'
          ? total.toFixed(0)
          : moneyStr(total);
  }
  return out;
}
