'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { flushQueue, queueCount } from './queue';

export interface SyncState {
  online: boolean;
  pending: number;
  blocked: number;
  syncing: boolean;
  lastSyncAt: Date | null;
}

/**
 * Watches the connection and drains the queue whenever the phone can reach the
 * server: on reconnect, when the screen comes back to the foreground, and on a
 * slow timer as a backstop for the case where `online` never fires because the
 * phone has a bar of signal that does not actually carry traffic.
 */
export function useSync(userId: string) {
  const [state, setState] = useState<SyncState>({
    online: true,
    pending: 0,
    blocked: 0,
    syncing: false,
    lastSyncAt: null,
  });

  const refreshCounts = useCallback(async () => {
    const { pending, blocked } = await queueCount();
    setState((s) => ({ ...s, pending, blocked }));
  }, []);

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    setState((s) => (s.syncing ? s : { ...s, syncing: true }));
    try {
      const result = await flushQueue(createClient(), userId);
      setState((s) => ({
        ...s,
        syncing: false,
        pending: result.remaining - result.blocked,
        blocked: result.blocked,
        lastSyncAt: result.sent > 0 ? new Date() : s.lastSyncAt,
      }));
    } catch {
      setState((s) => ({ ...s, syncing: false }));
    }
  }, [userId]);

  useEffect(() => {
    setState((s) => ({ ...s, online: navigator.onLine }));
    void refreshCounts();

    function handleOnline() {
      setState((s) => ({ ...s, online: true }));
      void sync();
    }
    function handleOffline() {
      setState((s) => ({ ...s, online: false }));
    }
    function handleVisible() {
      if (document.visibilityState === 'visible') {
        setState((s) => ({ ...s, online: navigator.onLine }));
        void sync();
      }
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisible);

    void sync();
    const timer = setInterval(() => void sync(), 30_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisible);
      clearInterval(timer);
    };
  }, [sync, refreshCounts]);

  return { ...state, sync, refreshCounts };
}
