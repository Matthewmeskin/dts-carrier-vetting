import type { Metadata } from 'next'
import { SiteHeader } from '@/components/SiteHeader'
import './globals.css'

export const metadata: Metadata = {
  title: 'DTS Carrier Compliance Portal',
  description:
    'Track carrier compliance, monitor vetting policy, and document reasonable care for Diversified Transportation Services.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <SiteHeader />
          <main className="flex-1 mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
            {children}
          </main>
          <footer className="border-t border-gray-200 bg-white">
            <div className="mx-auto max-w-[1400px] px-4 py-4 text-xs text-gray-500 sm:px-6">
              Diversified Transportation Services — Torrance, CA · Internal
              compliance tool
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
