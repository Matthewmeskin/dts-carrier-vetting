import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/Logo'
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
          <header className="bg-white border-b border-gray-200 shadow-sm">
            <div className="mx-auto max-w-[1400px] px-6 py-2.5 flex items-center justify-between">
              <Link href="/carriers" className="flex items-center gap-3">
                <Logo className="h-10 w-auto" />
                <span className="hidden border-l border-gray-200 pl-3 text-sm font-medium text-gray-500 sm:inline">
                  Carrier Compliance Portal
                </span>
              </Link>
              <nav className="flex items-center gap-1 text-sm">
                <Link
                  href="/carriers"
                  className="rounded px-3 py-1.5 text-gray-700 transition hover:bg-gray-100"
                >
                  Carriers
                </Link>
                <Link
                  href="/changes"
                  className="rounded px-3 py-1.5 text-gray-700 transition hover:bg-gray-100"
                >
                  Changes
                </Link>
                <Link
                  href="/factors"
                  className="rounded px-3 py-1.5 text-gray-700 transition hover:bg-gray-100"
                >
                  Factors
                </Link>
                <Link
                  href="/upload"
                  className="rounded px-3 py-1.5 text-gray-700 transition hover:bg-gray-100"
                >
                  Upload Scores
                </Link>
              </nav>
            </div>
          </header>
          <main className="flex-1 mx-auto w-full max-w-[1400px] px-6 py-6">
            {children}
          </main>
          <footer className="border-t border-gray-200 bg-white">
            <div className="mx-auto max-w-[1400px] px-6 py-4 text-xs text-gray-500">
              Diversified Transportation Services — Torrance, CA · Internal
              compliance tool
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
