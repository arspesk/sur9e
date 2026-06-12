import type { Metadata } from 'next';
import { IBM_Plex_Mono, Inter } from 'next/font/google';
import localFont from 'next/font/local';
import { DeleteConfirmModal } from '@/components/delete-confirm-modal';
import { LoadingModalHost } from '@/components/loading-modal/loading-modal';
import { ModalHost } from '@/components/modal-host';
import { ChromeEffects } from '@/components/shell/chrome-effects';
import { MobileNav } from '@/components/shell/mobile-nav';
import { RailNav } from '@/components/shell/rail-nav';
import { RailStyles, ThemeScript } from '@/components/shell/theme-script';
import { StatusPopoverHost } from '@/components/status-popover-host';
import { Toaster } from '@/components/toast/toaster';
import { Providers } from './providers';
import './globals.css';
import './styles/report-hero.css';
import './styles/report-snapshot.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

const generalSans = localFont({
  src: [
    {
      path: '../../public/fonts/general-sans/GeneralSans-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../public/fonts/general-sans/GeneralSans-Medium.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../../public/fonts/general-sans/GeneralSans-Semibold.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../../public/fonts/general-sans/GeneralSans-Bold.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-general-sans',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Sur9e',
  description: 'AI job-hunt CRM',
};

// Explicit viewport so Next emits <meta name="viewport"> verbatim — relying
// on the default is fine for most cases but having it here documents intent
// and lets us tune (e.g. viewport-fit=cover for safe-area-inset support).
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover' as const,
  // Match the page canvas (--bg) so mobile browser chrome blends with the
  // app: cream in light, near-black in dark. Media-aware pair follows the
  // SYSTEM scheme — there is no client-side updater for the in-app
  // data-theme toggle, so a user who forces the opposite theme keeps the
  // system-matched bar color (acceptable: the values mirror tokens.css --bg).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf9f6' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${generalSans.variable} ${ibmPlexMono.variable}`}
    >
      <head>
        <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <ThemeScript />
        <RailStyles />
        <Providers>
          <ChromeEffects />
          {/* data-rail="full" hardcoded server-side so the rail labels
              + 220px grid render correctly BEFORE React hydrates. The
              pre-paint ThemeScript sets :root[data-rail] from localStorage;
              ChromeEffects mirrors that to .app post-hydration. Without
              this default on the server-render the rail collapsed to
              compact (no labels) for ~2.5s during R-25 reload windows. */}
          <div className="app" data-rail="full">
            <RailNav />
            {/* tabIndex={-1} makes the skip-link target programmatically
                focusable so activating "Skip to content" moves keyboard
                focus into main, not just the scroll position. */}
            <main id="main" className="main" tabIndex={-1}>
              {children}
            </main>
          </div>
          <MobileNav />
          <Toaster />
          <LoadingModalHost />
          <DeleteConfirmModal />
          <ModalHost />
          <StatusPopoverHost />
        </Providers>
      </body>
    </html>
  );
}
