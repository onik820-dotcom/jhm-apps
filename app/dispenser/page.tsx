import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getCurrentShift, getMySubmissionCount } from '@/lib/data/overview';
import { DispenserScreen } from './dispenser-screen';

/**
 * The forecourt screen. Three buttons and a count — no money, no rate, no
 * total, no customer, no navigation. RLS enforces the same thing underneath:
 * this role can read only its own rows from the shift it is standing in.
 */
export default async function DispenserPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'dispenser') redirect('/');

  const shift = await getCurrentShift();
  const counts = await getMySubmissionCount(shift?.id ?? null);

  return (
    <DispenserScreen
      fullName={profile.fullNameBn ?? profile.fullName}
      shift={shift}
      submitted={counts.readings + counts.dips}
    />
  );
}
