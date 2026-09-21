import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/lib/supabase/server';
import { getExpenseCategories, getExpenses } from '@/lib/data/money';
import { AppShell } from '@/components/app-shell';
import { ExpensesScreen } from './expenses-screen';

export default async function ExpensesPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'manager' && profile.role !== 'admin') redirect('/');

  const [book, categories] = await Promise.all([getExpenses(), getExpenseCategories()]);

  return (
    <AppShell role={profile.role} fullName={profile.fullName}>
      <ExpensesScreen book={book} categories={categories} />
    </AppShell>
  );
}
