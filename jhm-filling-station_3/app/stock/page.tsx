import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getDispenserDetails, getTankDetails } from '@/lib/data/stock';
import { AppShell } from '@/components/app-shell';
import { StockPage } from './stock-page';

export default async function Stock() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/');

  const [tanks, dispensers] = await Promise.all([getTankDetails(), getDispenserDetails()]);

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <StockPage tanks={tanks} dispensers={dispensers} isAdmin={profile.role === 'admin'} />
    </AppShell>
  );
}
