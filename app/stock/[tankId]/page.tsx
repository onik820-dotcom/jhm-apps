import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getCalibrationCurve, getCalibrationPage, getTankDetail } from '@/lib/data/stock';
import { AppShell } from '@/components/app-shell';
import { CalibrationViewer } from '@/components/stock/calibration-viewer';
import { DipConverter } from '@/components/stock/dip-converter';
import { TankMetadataCard } from '@/components/stock/tank-metadata-card';

const WINDOW = 40;

export default async function TankCalibrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ tankId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/');

  const { tankId } = await params;
  const tank = await getTankDetail(tankId);
  if (!tank) notFound();

  const version = tank.chartVersion ?? 1;
  const finalDip = tank.finalDipMm ?? 1;

  const requested = Number((await searchParams).from ?? '1');
  const from = Number.isFinite(requested) ? Math.min(Math.max(1, Math.floor(requested)), Math.max(1, finalDip - WINDOW + 1)) : 1;

  const [page, curve] = await Promise.all([
    getCalibrationPage(tankId, version, from, from + WINDOW - 1),
    getCalibrationCurve(tankId, version),
  ]);

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <div className="space-y-4">
        <Link
          href="/stock"
          className="text-xs font-medium"
          style={{ color: 'var(--color-accent)' }}
        >
          ← {tank.code}
        </Link>

        <TankMetadataCard tank={tank} />

        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <CalibrationViewer
            tankId={tank.id}
            tankCode={tank.code}
            version={version}
            finalDipMm={finalDip}
            totalRows={page.total}
            initialRows={page.rows}
            initialFrom={from}
            curve={curve}
            isAdmin={profile.role === 'admin'}
          />

          <DipConverter tankId={tank.id} tankCode={tank.code} finalDipMm={tank.finalDipMm} />
        </div>
      </div>
    </AppShell>
  );
}
