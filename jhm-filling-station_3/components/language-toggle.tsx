'use client';

import { Languages } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';

/** Switches labels and numerals together — Bangla numerals when Bangla is on. */
export function LanguageToggle() {
  const { lang, setLang, t } = useLang();
  return (
    <Button
      variant="glass"
      size="sm"
      onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}
      aria-label={lang === 'bn' ? 'Switch to English' : 'বাংলায় দেখুন'}
    >
      <Languages className="h-3.5 w-3.5" aria-hidden />
      {t('common.language')}
    </Button>
  );
}
