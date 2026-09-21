import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getCurrentShift, getTankOverview } from '@/lib/data/overview';
import { getDashboardKpis } from '@/lib/data/dashboard';
import { AppShell } from '@/components/app-shell';
import { ManagerDashboard } from './manager-dashboard';

export default async function ManagerPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/');

  const [shift, tanks, kpis] = await Promise.all([
    getCurrentShift(),
    getTankOverview(),
    getDashboardKpis(),
  ]);

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <ManagerDashboard shift={shift} tanks={tanks} kpis={kpis} />
    </AppShell>
  );
}
