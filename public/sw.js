/* eslint-disable no-undef */

/**
 * The service worker.
 *
 * WHY THIS IS HAND-WRITTEN AND DELIBERATELY SMALL
 *
 * The obvious move is a Workbox config from a PWA plugin. The default runtime
 * caching those generate serves pages and API responses from cache first, or
 * stale-while-revalidate, so a bad connection quietly produces a page that
 * looks fine and is out of date.
 *
 * In this app that means a manager opens Dues on one bar of signal and reads
 * yesterday's balance as though it were today's. Every screen here is a server
 * component rendering live money: caching the HTML *is* caching the numbers.
 * A system whose first rule is that a figure is never silently wrong cannot
 * ship a cache that silently serves a wrong one.
 *
 * So the rule here is narrow and absolute:
 *
 *   CACHED      the build's own static assets, which are content-hashed and
 *               therefore can never be stale, and one offline notice page.
 *
 *   NEVER       any HTML document, any /api route, anything from Supabase.
 *               Offline, those fail — and failing is the honest answer,
 *               because the dispenser's queue in IndexedDB is what actually
 *               keeps work going without signal, not a stale screen.
 *
 * The offline story for the forecourt is Phase 3's IndexedDB queue, which
 * holds readings and dips on the device and syncs on reconnect. This worker
 * exists to make the app installable and to start fast, not to pretend the
 * network is there.
 */

const VERSION = 'jhm-v1';
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Only the offline notice is precached. Everything else arrives as it is
      // asked for, and only if it is safe to keep.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from an older build so a deploy cannot leave a mix of two.
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Content-hashed build output. A hit can never be stale — the name changes. */
function isImmutableAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/'))
  );
}

/** Anything that carries live figures, or could. */
function carriesLiveData(url, request) {
  if (url.pathname.startsWith('/api/')) return true;
  if (url.hostname.endsWith('.supabase.co')) return true;
  if (request.mode === 'navigate') return true;
  if (request.headers.get('accept')?.includes('text/html')) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // A cache can only answer a GET. Everything else goes straight out, which is
  // what we want anyway: a POST that closes a shift must never be replayed
  // from a cache.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (carriesLiveData(url, request)) {
    event.respondWith(networkOnly(request));
    return;
  }

  // Fonts, images and anything else static-ish: try the network, fall back to
  // whatever was kept. None of it is a number.
  event.respondWith(networkThenCache(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * No cache, ever. A navigation that cannot reach the server gets the offline
 * notice, which says plainly that it is not showing live figures — rather than
 * a page that looks normal and is not.
 */
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (error) {
    if (request.mode === 'navigate') {
      const offline = await caches.match(OFFLINE_URL);
      if (offline) return offline;
    }
    throw error;
  }
}

async function networkThenCache(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

/** Let a new build take over without the person having to close every tab. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
