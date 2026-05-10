import type { Metadata } from 'next';
import { Heebo } from 'next/font/google';
import { he } from '@fba/shared';
import { NavigationLoader } from '@/components/navigation-loader';
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
        {/* Click-driven full-screen overlay loader. Fires the moment the
            user clicks an internal link, before the server roundtrip even
            starts — eliminates the "I clicked but nothing happened" gap.
            Falls away as soon as Next.js navigates to the new URL; if the
            destination's loading.tsx then takes over, it's the same
            <AppLoader>, so the user sees one continuous loader. */}
        <NavigationLoader />
        {children}
      </body>
    </html>
  );
}
