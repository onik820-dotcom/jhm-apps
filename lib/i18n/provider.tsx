'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Lang } from '@/lib/format';
import { translate, type TranslationKey } from './dictionary';

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

const STORAGE_KEY = 'jhm.lang';

export function LanguageProvider({ children, initialLang = 'bn' }: { children: React.ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'bn' || stored === 'en') setLangState(stored);
    } catch {
      // Private browsing or blocked storage: the profile default stands.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Remembering the choice is a convenience, not a requirement.
    }
  }, []);

  const value = useMemo<LangContextValue>(
    () => ({ lang, setLang, t: (key) => translate(lang, key) }),
    [lang, setLang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used inside a LanguageProvider');
  return ctx;
}
