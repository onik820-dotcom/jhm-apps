import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { businessDate } from '@/lib/format';
import { reportById, reportsForRole, visibleColumns } from '@/lib/reports/registry';
import { runReport } from '@/lib/reports/run';
import { AppShell } from '@/components/app-shell';
import { ReportsScreen } from './reports-screen';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string; from?: string; to?: string }>;
}) {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role === 'dispenser') redirect('/dispenser');

  const available = reportsForRole(profile.role);
  const params = await searchParams;

  const today = businessDate();
  const requested = params.r ?? available[0]?.id ?? 'daily-sheet';
  // A role that cannot open a report does not get a broken page: it gets the
  // first report it is allowed to see.
  const report = reportById(requested);
  const id = report && report.roles.includes(profile.role) ? requested : (available[0]?.id ?? 'daily-sheet');

  const chosen = reportById(id)!;
  const to = params.to ?? today;
  const from = chosen.period === 'day' ? to : (params.from ?? monthStart(to));

  const canSeeCost = profile.role === 'admin' || profile.role === 'md';
  const result = await runReport(id, from, to, canSeeCost);

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <ReportsScreen
        available={available.map((r) => ({
          id: r.id,
          en: r.en,
          bn: r.bn,
          descriptionEn: r.descriptionEn,
          descriptionBn: r.descriptionBn,
          period: r.period,
          layout: r.layout ?? null,
        }))}
        reportId={id}
        columns={visibleColumns(chosen, canSeeCost)}
        rows={result.rows}
        totals={result.totals}
        sheet={result.sheet ?? null}
        statement={result.statement ?? null}
        error={result.error ?? null}
        from={from}
        to={to}
        period={chosen.period}
      />
    </AppShell>
  );
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
