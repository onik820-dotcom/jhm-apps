import fs from 'node:fs';
import path from 'node:path';
import { indexChart, type CalibrationChart, type IndexedChart } from '../dip';

const SEED_DIR = path.resolve(process.cwd(), 'seed');

/** JHM's certified charts run 31-01-2022 → 30-01-2027. */
export const VALID_FROM = new Date('2022-01-31T00:00:00+06:00');
export const VALID_TO = new Date('2027-01-30T23:59:59+06:00');

export function loadChartCsv(file: string, tankId: string, tankCode: string, finalDipMm: number): CalibrationChart {
  const raw = fs.readFileSync(path.join(SEED_DIR, file), 'utf8');
  const lines = raw.trim().split(/\r?\n/);
  lines.shift(); // tank_code,dip_mm,litres
  const rows = lines.map((line) => {
    const [, dipMm, litres] = line.split(',');
    return { dipMm: Number(dipMm), litres: litres!.trim() };
  });
  return { tankId, tankCode, version: 1, finalDipMm, validFrom: VALID_FROM, validTo: VALID_TO, rows };
}

let t1: IndexedChart | null = null;
let t2: IndexedChart | null = null;

export function tank1Chart(): IndexedChart {
  t1 ??= indexChart(loadChartCsv('tank1_calibration.csv', 'tank-1', 'T1', 2070));
  return t1;
}

export function tank2Chart(): IndexedChart {
  t2 ??= indexChart(loadChartCsv('tank2_calibration.csv', 'tank-2', 'T2', 2051));
  return t2;
}
