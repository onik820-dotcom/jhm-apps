import { ImageResponse } from 'next/og';

/**
 * App icons, drawn rather than stored.
 *
 * Next renders these from JSX, so there are no binary assets in the repo to
 * drift out of date and no image pipeline to install. Two sizes and a maskable
 * variant is everything a manifest and an iOS home screen need.
 *
 * The maskable version matters on Android: the launcher crops an icon to
 * whatever shape the phone's theme uses, and an icon that fills its square
 * gets its corners eaten. The maskable one keeps the mark inside the safe
 * circle and lets the background take the cropping.
 */

export const dynamic = 'force-static';

const ALLOWED = new Set([192, 512]);

export function generateStaticParams() {
  return [{ size: '192' }, { size: '512' }];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size: raw } = await params;
  const size = Number(raw);
  if (!ALLOWED.has(size)) {
    return new Response('Not found', { status: 404 });
  }

  const maskable = new URL(request.url).searchParams.get('maskable') === '1';
  // A maskable icon must keep its mark inside the inner 80% circle, because
  // the launcher may crop anything outside it.
  const pad = maskable ? size * 0.18 : size * 0.1;
  const inner = size - pad * 2;

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1e40af',
          // A full-bleed background for the maskable variant; a rounded square
          // for the plain one, which is shown uncropped.
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <div
          style={{
            width: inner,
            height: inner,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ffffff',
          }}
        >
          <div
            style={{
              fontSize: inner * 0.34,
              fontWeight: 700,
              letterSpacing: inner * -0.01,
              lineHeight: 1,
              display: 'flex',
            }}
          >
            JHM
          </div>
          <div
            style={{
              marginTop: inner * 0.08,
              width: inner * 0.44,
              height: Math.max(2, inner * 0.035),
              background: '#ffffff',
              opacity: 0.85,
              borderRadius: 999,
              display: 'flex',
            }}
          />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
