import type { MetadataRoute } from 'next';

/**
 * The install manifest.
 *
 * The dispenser's phone is the reason this exists. A forecourt employee should
 * tap an icon on the home screen, not find a bookmark — and an installed app
 * gets a full-height viewport, which matters when the three-button screen has
 * to be usable one-handed in sunlight.
 *
 * Bangla first, because that is the language of the station. `lang` and `dir`
 * here are what an installed shortcut announces to the launcher.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'J.H.M. Filling Station',
    short_name: 'JHM',
    description:
      'Shift, stock and accounts for M/S. J.H.M. Filling Station, Chengutia, Abhaynagar, Jashore.',
    lang: 'bn',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f8fafc',
    theme_color: '#1e40af',
    categories: ['business', 'productivity', 'finance'],
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/512?maskable=1', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // The two things a dispenser opens the app to do. A long-press on the
    // installed icon goes straight there instead of through the dashboard.
    shortcuts: [
      {
        name: 'Take a meter reading',
        short_name: 'Meter',
        url: '/dispenser/meter',
        icons: [{ src: '/icons/192', sizes: '192x192' }],
      },
      {
        name: 'Enter a tank dip',
        short_name: 'Dip',
        url: '/dispenser/dip',
        icons: [{ src: '/icons/192', sizes: '192x192' }],
      },
    ],
  };
}
