'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fuel, LogOut } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import type { TranslationKey } from '@/lib/i18n/dictionary';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/roles';
import { LanguageToggle } from '@/components/language-toggle';
import { Chip } from '@/components/ui/glass';
import { ChatPanel } from '@/components/chat/chat-panel';

interface NavItem {
  href: string;
  key: TranslationKey;
  roles: Role[];
}

const NAV: NavItem[] = [
  { href: '/manager', key: 'nav.dashboard', roles: ['manager'] },
  { href: '/admin', key: 'nav.dashboard', roles: ['admin'] },
  { href: '/md', key: 'nav.dashboard', roles: ['md'] },
  { href: '/stock', key: 'nav.stock', roles: ['manager', 'admin'] },
  { href: '/shift/close', key: 'nav.shiftClose', roles: ['manager', 'admin'] },
  { href: '/refill', key: 'nav.refill', roles: ['manager', 'admin'] },
  { href: '/cash', key: 'nav.cash', roles: ['manager', 'admin'] },
  { href: '/dues', key: 'nav.dues', roles: ['manager', 'admin'] },
  { href: '/expenses', key: 'nav.expenses', roles: ['manager', 'admin'] },
  { href: '/lubricants', key: 'nav.lubricants', roles: ['manager', 'admin'] },
  { href: '/reports', key: 'nav.reports', roles: ['manager', 'admin', 'md'] },
  { href: '/people', key: 'nav.people', roles: ['admin'] },
  { href: '/audit', key: 'nav.audit', roles: ['admin'] },
];

const ROLE_LABEL: Record<Role, TranslationKey> = {
  dispenser: 'role.dispenser',
  manager: 'role.manager',
  admin: 'role.admin',
  md: 'role.md',
};

export function AppShell({
  role,
  fullName,
  children,
}: {
  role: Role;
  fullName: string;
  children: React.ReactNode;
}) {
  const { t, lang } = useLang();
  const pathname = usePathname();
  const items = NAV.filter((item) => item.roles.includes(role));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-6 sm:pt-4">
        <div className="glass mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-3 py-2.5 sm:px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}
            >
              <Fuel className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold tracking-tight" lang={lang}>
                {t('app.name')}
              </span>
              <span className="block truncate text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {fullName}
              </span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <Chip lang={lang}>{t(ROLE_LABEL[role])}</Chip>
            <LanguageToggle />
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="tap-target inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium"
                style={{ color: 'var(--text-muted)' }}
                lang={lang}
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{t('auth.signOut')}</span>
              </button>
            </form>
          </div>

          {items.length > 1 ? (
            <nav className="-mx-1 flex w-full gap-1 overflow-x-auto pb-0.5" aria-label="Sections">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    lang={lang}
                    className={cn(
                      'tap-target shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap',
                      active ? 'text-white' : '',
                    )}
                    style={
                      active
                        ? { background: 'var(--color-accent)' }
                        : { color: 'var(--text-muted)' }
                    }
                  >
                    {t(item.key)}
                  </Link>
                );
              })}
            </nav>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-7">{children}</main>

      {/* The assistant answers from live data, so it only goes where that data
          is already allowed. A dispenser sees no money on any screen and gets
          no chat that could read them one. */}
      {role !== "dispenser" ? <ChatPanel /> : null}
    </div>
  );
}
