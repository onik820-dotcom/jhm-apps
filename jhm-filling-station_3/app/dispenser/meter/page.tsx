import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getCurrentShift } from '@/lib/data/overview';
import { getNozzleOptions } from '@/lib/data/dispenser';
import { MeterScreen } from './meter-screen';

export default async function MeterPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'dispenser' && profile.role !== 'manager' && profile.role !== 'admin') redirect('/');

  const [shift, nozzles] = await Promise.all([getCurrentShift(), getNozzleOptions()]);

  return <MeterScreen shiftId={shift?.id ?? null} nozzles={nozzles} userId={profile.id} />;
}
