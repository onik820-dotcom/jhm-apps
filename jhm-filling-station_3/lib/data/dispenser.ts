import 'server-only';
import { createClient } from '@/lib/supabase/server';

export interface NozzleOption {
  nozzleId: string;
  dispenserCode: string;
  nozzleNo: number;
  tankCode: string;
}

export interface TankOption {
  id: string;
  code: string;
  finalDipMm: number;
}

/** Active nozzles, for the machine picker on the capture screen. */
export async function getNozzleOptions(): Promise<NozzleOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('nozzles')
    .select('id, nozzle_no, status, dispensers!inner(code, status, deleted_at, tanks(code))')
    .is('deleted_at', null)
    .eq('status', 'active')
    .order('nozzle_no');

  if (error || !data) return [];

  return (data as unknown as Array<{
    id: string;
    nozzle_no: number;
    dispensers: { code: string; status: string; deleted_at: string | null; tanks: { code: string } | null } | null;
  }>)
    .filter((row) => row.dispensers && row.dispensers.status === 'active' && !row.dispensers.deleted_at)
    .map((row) => ({
      nozzleId: row.id,
      dispenserCode: row.dispensers!.code,
      nozzleNo: row.nozzle_no,
      tankCode: row.dispensers!.tanks?.code ?? '—',
    }))
    .sort((a, b) => a.dispenserCode.localeCompare(b.dispenserCode) || a.nozzleNo - b.nozzleNo);
}

/**
 * Tanks a dip can be taken on. A tank with no certified chart is left out — a
 * dip on it could not be converted, so recording one would only create a row
 * nobody can use.
 */
export async function getTankOptions(): Promise<TankOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tanks')
    .select('id, code, status, tank_metadata(final_dip_mm)')
    .is('deleted_at', null)
    .eq('status', 'active')
    .order('code');

  if (error || !data) return [];

  return (data as unknown as Array<{
    id: string;
    code: string;
    tank_metadata: Array<{ final_dip_mm: number }> | null;
  }>)
    .filter((row) => row.tank_metadata?.[0]?.final_dip_mm)
    .map((row) => ({
      id: row.id,
      code: row.code,
      finalDipMm: row.tank_metadata![0]!.final_dip_mm,
    }));
}
