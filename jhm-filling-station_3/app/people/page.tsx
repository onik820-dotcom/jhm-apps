import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getInvitations, getPeople } from '@/lib/data/people';
import { AppShell } from '@/components/app-shell';
import { PeopleBoard } from './people-board';

export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'admin') redirect('/');

  const [people, invitations] = await Promise.all([getPeople(), getInvitations()]);

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <PeopleBoard people={people} invitations={invitations} meId={profile.id} />
    </AppShell>
  );
}
