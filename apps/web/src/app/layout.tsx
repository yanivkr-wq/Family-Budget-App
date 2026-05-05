import type { Metadata } from 'next';
import { Heebo } from 'next/font/google';
import { Suspense } from 'react';
import { he } from '@fba/shared';
import { NavigationProgress } from '@/components/navigation-progress';
import './globals.css';

const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  variable: '--font-heebo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: he.app.name,
  description: he.app.tagline,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable} suppressHydrationWarning>
      {/* suppressHydrationWarning on <body> too — Grammarly and similar
          browser extensions inject data-* attributes here before React
          loads, which otherwise produces a noisy hydration warning. */}
      <body
        className="min-h-screen bg-background font-sans antialiased"
        suppressHydrationWarning
      >
        {/* useSearchParams() inside NavigationProgress requires Suspense */}
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
