'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { LanguageProvider } from '@/lib/i18n/provider';
import type { Lang } from '@/lib/format';
import { PwaInstall } from '@/components/pwa/install';

export function Providers({ children, lang = 'bn' }: { children: React.ReactNode; lang?: Lang }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Forecourt figures go stale quickly, but a phone on a weak signal
            // should not refetch on every focus change.
            staleTime: 30_000,
            retry: 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider initialLang={lang}>
        {children}
        {/* Registers the service worker and offers the home-screen install.
            Inside LanguageProvider because both of its notices are bilingual. */}
        <PwaInstall />
      </LanguageProvider>
    </QueryClientProvider>
  );
}
