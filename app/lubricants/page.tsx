import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getLubMovements, getLubSkus, summariseMovements } from '@/lib/data/lubricants';
import { getCreditParties } from '@/lib/data/money';
import { AppShell } from '@/components/app-shell';
import { LubricantsScreen } from './lubricants-screen';

export default async function LubricantsPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/');

  const canSeeCost = profile.role === 'admin';
  const [skus, movements, parties] = await Promise.all([
    getLubSkus(canSeeCost),
    getLubMovements(),
    getCreditParties(),
  ]);

  // Summed here rather than in the browser: the totals are derived from money,
  // so they are worked out where decimal.js and the raw rows both live.
  const now = new Date();
  const summary = summariseMovements(movements, new Date(now.getFullYear(), now.getMonth(), 1));

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <LubricantsScreen
        skus={skus}
        movements={movements}
        summary={summary}
        parties={parties.filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name }))}
        canSeeCost={canSeeCost}
      />
    </AppShell>
  );
}
