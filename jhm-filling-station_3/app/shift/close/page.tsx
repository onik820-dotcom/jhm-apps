import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getCloseContext } from '@/lib/data/shift-close';
import { AppShell } from '@/components/app-shell';
import { CloseScreen } from './close-screen';

export default async function ShiftClosePage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/');

  const context = await getCloseContext();

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <CloseScreen context={context} />
    </AppShell>
  );
}
