import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getTankOverview } from '@/lib/data/overview';
import { getDashboardKpis } from '@/lib/data/dashboard';
import { AppShell } from '@/components/app-shell';
import { MdDashboard } from './md-dashboard';

/**
 * Read-only, live. There is not a single mutating control on this page, and
 * RLS grants the md role SELECT and nothing else, so the restriction holds
 * even if a control were added by mistake.
 */
export default async function MdPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'md') redirect('/');

  const [tanks, kpis] = await Promise.all([getTankOverview(), getDashboardKpis()]);

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <MdDashboard tanks={tanks} kpis={kpis} />
    </AppShell>
  );
}
