/**
 * Seeds the certified calibration charts and one user per role.
 *
 * The static rows — station, settings, tanks, metadata, dispensers, nozzles,
 * expense categories, credit parties, lubricant SKUs — are in
 * supabase/migrations/0007_seed_static.sql and are applied with the migrations.
 * This script handles the two things SQL files are a poor fit for: 4,121 rows
 * of certified chart data read from CSV, and auth users.
 *
 *   npm run seed
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY, and the four SEED_*_EMAIL / _PASSWORD
 * pairs. Nothing is hardcoded: this script will not invent a password for an
 * account that can see the station's money.
 */
import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { indexChart, type CalibrationRow } from '../lib/calc/dip';

config({ path: '.env.local' });
config({ path: '.env' });

const SEED_DIR = path.resolve(process.cwd(), 'seed');

const CHARTS = [
  { file: 'tank1_calibration.csv', tankCode: 'T1', finalDipMm: 2070 },
  { file: 'tank2_calibration.csv', tankCode: 'T2', finalDipMm: 2051 },
] as const;

const CHART_VALID_FROM = '2022-01-31';
const CHART_VALID_TO = '2027-01-30';
const CHART_VERSION = 1;

const SEED_USERS = [
  { role: 'dispenser', envPrefix: 'SEED_DISPENSER', fullName: 'Seed Dispenser', fullNameBn: 'ডিসপেনসার' },
  { role: 'manager', envPrefix: 'SEED_MANAGER', fullName: 'Seed Manager', fullNameBn: 'পাম্প ম্যানেজার' },
  { role: 'admin', envPrefix: 'SEED_ADMIN', fullName: 'Seed Admin', fullNameBn: 'হিসাব বিভাগ' },
  { role: 'md', envPrefix: 'SEED_MD', fullName: 'Seed Managing Director', fullNameBn: 'ব্যবস্থাপনা পরিচালক' },
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  return value;
}

function readChartCsv(file: string): Array<{ tankCode: string; dipMm: number; litres: string }> {
  const raw = fs.readFileSync(path.join(SEED_DIR, file), 'utf8');
  const lines = raw.trim().split(/\r?\n/);
  const header = lines.shift();
  if (!header || !header.toLowerCase().startsWith('tank_code,dip_mm,litres')) {
    throw new Error(`${file}: expected the header "tank_code,dip_mm,litres", found "${header}"`);
  }

  return lines.map((line, index) => {
    const [tankCode, dipMm, litres] = line.split(',');
    if (!tankCode || !dipMm || !litres) {
      throw new Error(`${file}: line ${index + 2} is malformed: "${line}"`);
    }
    return { tankCode: tankCode.trim(), dipMm: Number(dipMm), litres: litres.trim() };
  });
}

async function seedCalibration(supabase: SupabaseClient) {
  for (const chart of CHARTS) {
    const { data: tank, error: tankError } = await supabase
      .from('tanks')
      .select('id, code')
      .eq('code', chart.tankCode)
      .maybeSingle();

    if (tankError || !tank) {
      throw new Error(`Tank ${chart.tankCode} is missing. Apply the migrations first.`);
    }

    const rows = readChartCsv(chart.file);
    const wrongTank = rows.find((r) => r.tankCode !== chart.tankCode);
    if (wrongTank) {
      throw new Error(`${chart.file} contains a row for ${wrongTank.tankCode}, expected only ${chart.tankCode}`);
    }

    // Refuse to load a chart that is not strictly increasing or has a gap —
    // a hole here would silently mis-state stock for years.
    const calibrationRows: CalibrationRow[] = rows.map((r) => ({ dipMm: r.dipMm, litres: r.litres }));
    indexChart({
      tankId: tank.id,
      tankCode: chart.tankCode,
      version: CHART_VERSION,
      finalDipMm: chart.finalDipMm,
      validFrom: new Date(`${CHART_VALID_FROM}T00:00:00+06:00`),
      validTo: new Date(`${CHART_VALID_TO}T23:59:59+06:00`),
      rows: calibrationRows,
    });

    const { count: existing } = await supabase
      .from('tank_calibration')
      .select('id', { count: 'exact', head: true })
      .eq('tank_id', tank.id)
      .eq('version', CHART_VERSION);

    if ((existing ?? 0) === rows.length) {
      console.log(`  ${chart.tankCode}: ${rows.length} rows already loaded, skipping`);
      continue;
    }

    const payload = rows.map((r) => ({
      tank_id: tank.id,
      version: CHART_VERSION,
      dip_mm: r.dipMm,
      litres: r.litres,
      valid_from: CHART_VALID_FROM,
      valid_to: CHART_VALID_TO,
    }));

    const CHUNK = 500;
    for (let i = 0; i < payload.length; i += CHUNK) {
      const chunk = payload.slice(i, i + CHUNK);
      const { error } = await supabase
        .from('tank_calibration')
        .upsert(chunk, { onConflict: 'tank_id,version,dip_mm' });
      if (error) throw new Error(`${chart.tankCode}: ${error.message}`);
    }

    console.log(`  ${chart.tankCode}: ${rows.length} certified rows loaded (1–${chart.finalDipMm} mm → 12,000 L)`);
  }
}

async function seedUsers(supabase: SupabaseClient) {
  const { data: station } = await supabase.from('stations').select('id').limit(1).maybeSingle();

  for (const user of SEED_USERS) {
    const email = process.env[`${user.envPrefix}_EMAIL`];
    const password = process.env[`${user.envPrefix}_PASSWORD`];

    if (!email || !password) {
      console.log(`  ${user.role}: skipped — set ${user.envPrefix}_EMAIL and ${user.envPrefix}_PASSWORD to create it`);
      continue;
    }

    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: user.fullName },
    });

    let userId = created?.user?.id;

    if (error) {
      if (!/already.*registered|already been registered/i.test(error.message)) {
        throw new Error(`${user.role}: ${error.message}`);
      }
      const { data: list } = await supabase.auth.admin.listUsers({ perPage: 200 });
      userId = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
      if (!userId) throw new Error(`${user.role}: account exists but could not be found`);
    }

    const { error: profileError } = await supabase.from('profiles').upsert(
      {
        id: userId!,
        station_id: station?.id ?? null,
        full_name: user.fullName,
        full_name_bn: user.fullNameBn,
        role: user.role,
        is_active: true,
        language_pref: 'bn',
      },
      { onConflict: 'id' },
    );
    if (profileError) throw new Error(`${user.role} profile: ${profileError.message}`);

    console.log(`  ${user.role}: ${email}`);
  }
}

async function main() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log('Calibration charts');
  await seedCalibration(supabase);

  console.log('\nUsers');
  await seedUsers(supabase);

  console.log('\nSeed complete.');
}

main().catch((error: unknown) => {
  console.error('\nSeed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
