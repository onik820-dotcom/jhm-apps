import { createClient } from '@/lib/supabase/server';
import { dec, litresStr, moneyStr, sum } from '@/lib/calc/decimal';
import { asCost, asLitres, asMoney } from '@/lib/data/numeric';

/**
 * The Mobil shelf.
 *
 * Quantities are NUMERIC(12,3) because loose oil is drawn by the litre and
 * part-litres are ordinary. A can is still counted in the same column — a
 * 1 litre can is 1.000, and its pack size is carried on the SKU so a screen
 * can show "3 cans" without the database having to know about packs.
 */

export interface LubSku {
  id: string;
  name: string;
  nameBn: string | null;
  brand: string | null;
  packType: string;
  packSizeLitres: string | null;
  purchaseRate: string;
  saleRate: string;
  reorderLevel: string;
  isActive: boolean;
  qtyOnHand: string;
  /** Admin and MD only — a manager sells but is not shown what it cost. */
  avgCost?: string;
  stockValue?: string;
  belowReorder: boolean;
}

export async function getLubSkus(canSeeCost: boolean): Promise<LubSku[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('lub_skus')
    .select(
      'id, name, name_bn, brand, pack_type, pack_size_litres, current_purchase_rate, current_sale_rate, reorder_level, is_active, lub_stock(qty_on_hand, avg_cost)',
    )
    .is('deleted_at', null)
    .order('name');

  return (data ?? []).map((s) => {
    const joined = s.lub_stock as unknown as
      | { qty_on_hand: string; avg_cost: string }
      | { qty_on_hand: string; avg_cost: string }[]
      | null;
    const stock = Array.isArray(joined) ? joined[0] : joined;
    // PostgREST hands these over as JavaScript doubles; they become
    // fixed-point strings here and stay strings from here on.
    const qty = asLitres(stock?.qty_on_hand);
    const cost = asCost(stock?.avg_cost);

    return {
      id: s.id,
      name: s.name,
      nameBn: s.name_bn,
      brand: s.brand,
      packType: s.pack_type,
      packSizeLitres: s.pack_size_litres === null ? null : asLitres(s.pack_size_litres),
      purchaseRate: asMoney(s.current_purchase_rate),
      saleRate: asMoney(s.current_sale_rate),
      reorderLevel: asLitres(s.reorder_level),
      isActive: s.is_active,
      qtyOnHand: qty,
      ...(canSeeCost
        ? { avgCost: cost, stockValue: moneyStr(dec(qty).times(dec(cost))) }
        : {}),
      belowReorder:
        dec(asLitres(s.reorder_level)).greaterThan(0) &&
        dec(qty).lessThanOrEqualTo(dec(asLitres(s.reorder_level))),
    };
  });
}

export interface LubMovement {
  id: string;
  skuId: string;
  skuName: string;
  txnType: 'purchase' | 'sale' | 'own_use' | 'adjustment';
  qty: string;
  rate: string;
  amount: string;
  vehicleRef: string | null;
  customerName: string | null;
  note: string | null;
  txnAt: string;
}

export async function getLubMovements(limit = 60): Promise<LubMovement[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('lub_transactions')
    .select('id, sku_id, txn_type, qty, rate, amount, vehicle_ref, note, txn_at, lub_skus(name), customers(name)')
    .is('deleted_at', null)
    .order('txn_at', { ascending: false })
    .limit(limit);

  const first = <T>(v: unknown): T | null => (Array.isArray(v) ? (v[0] as T) ?? null : (v as T) ?? null);

  return (data ?? []).map((r) => ({
    id: r.id,
    skuId: r.sku_id,
    skuName: first<{ name: string }>(r.lub_skus)?.name ?? '—',
    txnType: r.txn_type,
    qty: asLitres(r.qty),
    rate: asMoney(r.rate),
    amount: asMoney(r.amount),
    vehicleRef: r.vehicle_ref,
    customerName: first<{ name: string }>(r.customers)?.name ?? null,
    note: r.note,
    txnAt: r.txn_at,
  }));
}

export interface LubSummary {
  soldQty: string;
  soldValue: string;
  ownUseQty: string;
  ownUseValue: string;
  purchasedQty: string;
  purchasedValue: string;
}

/**
 * Own use is reported next to sales but never inside them. Oil put into the
 * station's own lorries is a cost; adding it to the sales figure would invent
 * revenue and flatter the margin on every report that reads it.
 */
export function summariseMovements(movements: LubMovement[], since: Date): LubSummary {
  const within = movements.filter((m) => new Date(m.txnAt) >= since);
  const of = (type: LubMovement['txnType']) => within.filter((m) => m.txnType === type);

  const qty = (rows: LubMovement[]) => litresStr(sum(rows.map((r) => r.qty)));
  const value = (rows: LubMovement[]) => moneyStr(sum(rows.map((r) => r.amount)));

  return {
    soldQty: qty(of('sale')),
    soldValue: value(of('sale')),
    ownUseQty: qty(of('own_use')),
    ownUseValue: value(of('own_use')),
    purchasedQty: qty(of('purchase')),
    purchasedValue: value(of('purchase')),
  };
}
