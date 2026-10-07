import type { Metadata, Viewport } from 'next'
import { Montserrat, Lato } from 'next/font/google'
import { PortalShell } from '@/components/PortalShell'
import { IdleLogout } from '@/components/IdleLogout'
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${montserrat.variable} ${lato.variable}`}>
      <body>
        <IdleLogout />
        <PortalShell>{children}</PortalShell>
      </body>
    </html>
  )
}
