import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { ROLE_HOME } from '@/lib/roles';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; denied?: string }>;
}) {
  const profile = await getSessionProfile();
  if (profile) redirect(ROLE_HOME[profile.role]);

  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <LoginForm nextPath={params.next} errorCode={params.error} />
    </main>
  );
}
