import { WifiOff } from 'lucide-react';

/**
 * What a signed-in page falls back to when the network is gone.
 *
 * It deliberately shows no figures at all. The temptation with an offline page
 * is to render the last thing the person saw, and that is exactly the failure
 * this app is built to avoid: a balance on screen with nothing saying it is
 * yesterday's. Better a page that admits it knows nothing.
 *
 * It is a static page — no session, no data — so the service worker can hold
 * it and serve it with no server at all.
 */
export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass max-w-md space-y-4 p-6 text-center">
        <WifiOff className="mx-auto h-10 w-10" style={{ color: 'var(--color-watch)' }} aria-hidden />

        <div className="space-y-1">
          <h1 className="text-base font-semibold tracking-tight" lang="bn">
            এখন ইন্টারনেট নেই
          </h1>
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }} lang="en">
            No connection
          </h2>
        </div>

        <div className="space-y-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <p lang="bn">
            হিসাবের কোনো সংখ্যা এখানে দেখানো হচ্ছে না — পুরনো সংখ্যা দেখানোর চেয়ে কিছু না
            দেখানোই ভালো। সংযোগ ফিরলে পাতাটি আবার খুলুন।
          </p>
          <p lang="en">
            No figures are shown here on purpose. An out-of-date number that looks current is
            worse than no number at all. Reopen the page once you have a signal.
          </p>
        </div>

        <div
          className="rounded-xl border px-3 py-2 text-left text-xs"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <p className="font-medium" lang="bn">
            মিটার রিডিং ও ডিপ এখনো নেওয়া যাবে
          </p>
          <p className="mt-0.5" style={{ color: 'var(--text-faint)' }} lang="bn">
            ফোনে জমা থাকবে, সংযোগ ফিরলে নিজে থেকেই চলে যাবে।
          </p>
          <p className="mt-1.5 font-medium" lang="en">
            Meter readings and dips still work
          </p>
          <p className="mt-0.5" style={{ color: 'var(--text-faint)' }} lang="en">
            They are held on the phone and sync themselves when the signal comes back.
          </p>
        </div>
      </div>
    </div>
  );
}
