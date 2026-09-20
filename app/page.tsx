import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { ROLE_HOME } from '@/lib/roles';

/** Every role has its own home; nobody stays on the root path. */
export default async function RootPage() {
  const profile = await getSessionProfile();
  redirect(profile ? ROLE_HOME[profile.role] : '/login');
}
