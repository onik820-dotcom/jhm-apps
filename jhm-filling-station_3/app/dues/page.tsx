import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { ageingTotals, getCreditParties, getRecentPayments } from '@/lib/data/money';
import { AppShell } from '@/components/app-shell';
import { DuesScreen } from './dues-screen';

export default async function DuesPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/');

  const [parties, payments] = await Promise.all([getCreditParties(), getRecentPayments()]);

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <DuesScreen
        parties={parties}
        totals={ageingTotals(parties)}
        payments={payments}
        isAdmin={profile.role === 'admin'}
      />
    </AppShell>
  );
}
