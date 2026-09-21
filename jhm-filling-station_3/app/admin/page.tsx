import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getDispenserOverview, getTankOverview } from '@/lib/data/overview';
import { getDashboardKpis } from '@/lib/data/dashboard';
import { AppShell } from '@/components/app-shell';
import { AdminDashboard } from './admin-dashboard';

export default async function AdminPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'admin') redirect('/');

  const [tanks, dispensers, kpis] = await Promise.all([
    getTankOverview(),
    getDispenserOverview(),
    getDashboardKpis(),
  ]);

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <AdminDashboard tanks={tanks} dispensers={dispensers} kpis={kpis} />
    </AppShell>
  );
}
