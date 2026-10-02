import type { Metadata, Viewport } from 'next';
import { Inter, M_PLUS_2 } from 'next/font/google';

import { THEME_BOOT } from '@/lib/color-theme';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const mplus2 = M_PLUS_2({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false,
  variable: '--font-jp',
});

export const metadata: Metadata = {
  title: '資産形成',
  description: '負債の完済と資産形成を構造で支える、本人専用の個人財務環境',
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${inter.variable} ${mplus2.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
