import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getCashPosition } from '@/lib/data/money';
import { AppShell } from '@/components/app-shell';
import { CashScreen } from './cash-screen';

export default async function CashPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/');

  const position = await getCashPosition();

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <CashScreen position={position} />
    </AppShell>
  );
}
