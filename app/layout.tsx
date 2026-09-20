import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_Bengali } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// Bangla is not an afterthought here: it is the default language of the app.
const notoBengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  variable: '--font-noto-bengali',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'J.H.M. Filling Station',
  description: 'Shift, stock and accounts system for M/S. J.H.M. Filling Station, Chengutia, Abhaynagar, Jashore.',
  applicationName: 'JHM Filling Station',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The forecourt screen is used one-handed in sunlight; let people zoom.
  maximumScale: 5,
  themeColor: '#1e40af',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn" suppressHydrationWarning>
      <body className={`${inter.variable} ${notoBengali.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
