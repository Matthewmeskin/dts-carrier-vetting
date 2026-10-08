import type { Metadata, Viewport } from 'next'
import { Montserrat, Lato } from 'next/font/google'
import { PortalShell } from '@/components/PortalShell'
import { IdleLogout } from '@/components/IdleLogout'
import { ThemeSync } from '@/components/ThemeToggle'
import './globals.css'

// The same type pairing as the other DTS portals: Montserrat for headings and
// navigation, Lato for everything else.
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-montserrat',
  display: 'swap',
})

const lato = Lato({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-lato',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'DTS Carrier Vetting',
  description:
    'Track carrier compliance, monitor vetting policy, and document reasonable care for Diversified Transportation Services.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#AB0534',
}

// Runs while the HTML is parsed, before first paint: puts `dark` on <html>
// when the saved choice (localStorage 'theme', see components/ThemeToggle)
// is 'dark', or is unset/'system' and the OS prefers dark. Without it a dark
// user sees a white page until React loads. Keep it in step with
// applyTheme() in ThemeToggle.tsx.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // suppressHydrationWarning: the script below changes <html>'s class
    // before React hydrates, and the DOM is meant to win.
    <html lang="en" className={`${montserrat.variable} ${lato.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeSync />
        <IdleLogout />
        <PortalShell>{children}</PortalShell>
      </body>
    </html>
  )
}
