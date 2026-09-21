import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getDeliveries, getPurchaseRegister, getRefillTanks } from '@/lib/data/refill';
import { AppShell } from '@/components/app-shell';
import { RefillScreen } from './refill-screen';

export default async function RefillPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/');

  const [tanks, deliveries, register] = await Promise.all([
    getRefillTanks(),
    getDeliveries(),
    getPurchaseRegister(),
  ]);

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <RefillScreen
        tanks={tanks}
        deliveries={deliveries}
        register={register}
        canSeeCost={profile.role === 'admin'}
      />
    </AppShell>
  );
}
