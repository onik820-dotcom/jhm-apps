import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/roles';
import { JoinForm } from './join-form';
import { InvalidLink } from './invalid-link';

export const dynamic = 'force-dynamic';

interface Preview {
  email: string;
  role: Role;
  full_name: string;
  expires_at: string;
}

/**
 * The one page in this app that answers without a session, because the person
 * opening it does not have one yet and the whole point is to give them one.
 *
 * Nothing here is reachable without the token, and the token is 256 bits from
 * the database's own random source. A wrong one is told nothing at all — not
 * that it expired, not that it was used, not that the address exists.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const supabase = await createClient();
  const { data } = await supabase.rpc('invitation_preview', { p_token: token });
  const invitation = ((data ?? []) as Preview[])[0];

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      {invitation ? (
        <JoinForm
          token={token}
          email={invitation.email}
          role={invitation.role}
          fullName={invitation.full_name}
        />
      ) : (
        <InvalidLink />
      )}
    </main>
  );
}
