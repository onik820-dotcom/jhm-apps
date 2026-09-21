'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useLang } from '@/lib/i18n/provider';

/**
 * Registering the worker, and offering to install.
 *
 * Two jobs, one component, because both hang off the same lifecycle and
 * neither is worth its own mount.
 *
 * The install prompt is deliberately quiet. Chrome fires `beforeinstallprompt`
 * on nearly every visit, and a banner that reappears every morning is a banner
 * people learn to dismiss without reading. Turned down once, it stays down for
 * a month.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const SNOOZE_KEY = 'jhm.install.snoozed';
const SNOOZE_DAYS = 30;

export function PwaInstall() {
  const { lang } = useLang();
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [updateReady, setUpdateReady] = useState(false);

  // ---- register ----------------------------------------------------------
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // In development the worker would cache a build that is about to change
    // under it, which is a whole afternoon of confusing nonsense.
    if (process.env.NODE_ENV !== 'production') return;

    let registration: ServiceWorkerRegistration | undefined;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        registration = reg;
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // A new build is ready and an old one is still driving the page.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateReady(true);
            }
          });
        });
      })
      .catch(() => {
        // A failed registration costs nothing: the app is server-rendered and
        // works without it. Not worth telling anybody about.
      });

    return () => {
      void registration;
    };
  }, []);

  // ---- the install offer -------------------------------------------------
  useEffect(() => {
    function onPrompt(event: Event) {
      event.preventDefault();

      try {
        const snoozed = window.localStorage.getItem(SNOOZE_KEY);
        if (snoozed && Date.now() - Number(snoozed) < SNOOZE_DAYS * 864e5) return;
      } catch {
        /* private browsing — just show it */
      }

      setPrompt(event as InstallPromptEvent);
    }

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setPrompt(null));
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    // Either way the browser will not fire the event again this session.
    setPrompt(null);
  }, [prompt]);

  const snooze = useCallback(() => {
    try {
      window.localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setPrompt(null);
  }, []);

  const reload = useCallback(() => {
    navigator.serviceWorker.controller?.postMessage('skip-waiting');
    window.location.reload();
  }, []);

  if (updateReady) {
    return (
      <div className="no-print fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:left-6 sm:max-w-sm">
        <div className="glass flex items-center gap-3 px-4 py-3">
          <p className="flex-1 text-xs" lang={lang}>
            {lang === 'bn'
              ? 'নতুন সংস্করণ এসেছে।'
              : 'A new version is ready.'}
          </p>
          <button
            type="button"
            onClick={reload}
            className="tap-target rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: 'var(--color-accent)', color: 'white' }}
            lang={lang}
          >
            {lang === 'bn' ? 'হালনাগাদ' : 'Update'}
          </button>
        </div>
      </div>
    );
  }

  if (!prompt) return null;

  return (
    <div className="no-print fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:left-6 sm:max-w-sm">
      <div className="glass flex items-start gap-3 px-4 py-3">
        <Download className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--color-accent)' }} aria-hidden />
        <div className="flex-1">
          <p className="text-xs font-medium" lang={lang}>
            {lang === 'bn' ? 'ফোনের হোম স্ক্রিনে রাখুন' : 'Add to the home screen'}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-faint)' }} lang={lang}>
            {lang === 'bn'
              ? 'দ্রুত খুলবে, আর সিগন্যাল না থাকলেও রিডিং নেওয়া যাবে।'
              : 'Opens faster, and readings still work without a signal.'}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void install()}
              className="tap-target rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ background: 'var(--color-accent)', color: 'white' }}
              lang={lang}
            >
              {lang === 'bn' ? 'যোগ করুন' : 'Add'}
            </button>
            <button
              type="button"
              onClick={snooze}
              className="tap-target rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ color: 'var(--text-muted)' }}
              lang={lang}
            >
              {lang === 'bn' ? 'এখন না' : 'Not now'}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={snooze}
          aria-label={lang === 'bn' ? 'বন্ধ' : 'Dismiss'}
          className="tap-target rounded-lg p-1"
          style={{ color: 'var(--text-faint)' }}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
