import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getCurrentShift } from '@/lib/data/overview';
import { getTankOptions } from '@/lib/data/dispenser';
import { DipScreen } from './dip-screen';

export default async function DipPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'dispenser' && profile.role !== 'manager' && profile.role !== 'admin') redirect('/');

  const requested = (await searchParams).type;
  const dipType =
    requested === 'pre_refill' || requested === 'post_refill' ? requested : ('close' as const);

  const [shift, tanks] = await Promise.all([getCurrentShift(), getTankOptions()]);

  return <DipScreen shiftId={shift?.id ?? null} tanks={tanks} userId={profile.id} dipType={dipType} />;
}
