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
            <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-6">
              <Link href="/carriers" className="flex items-center gap-3">
                <Logo className="h-8 w-auto sm:h-10" />
                <span className="hidden border-l border-gray-200 pl-3 text-sm font-medium text-gray-500 sm:inline">
                  Carrier Compliance Portal
                </span>
              </Link>
              <nav className="-mx-1 flex w-full items-center gap-0.5 overflow-x-auto px-1 text-sm sm:w-auto sm:justify-end sm:gap-1">
                <Link
                  href="/carriers"
                  className="whitespace-nowrap rounded px-2.5 py-1.5 text-gray-700 transition hover:bg-gray-100 sm:px-3"
                >
                  Carriers
                </Link>
                <Link
                  href="/changes"
                  className="whitespace-nowrap rounded px-2.5 py-1.5 text-gray-700 transition hover:bg-gray-100 sm:px-3"
                >
                  Changes
                </Link>
                <Link
                  href="/factors"
                  className="whitespace-nowrap rounded px-2.5 py-1.5 text-gray-700 transition hover:bg-gray-100 sm:px-3"
                >
                  Factors
                </Link>
                <Link
                  href="/upload"
                  className="whitespace-nowrap rounded px-2.5 py-1.5 text-gray-700 transition hover:bg-gray-100 sm:px-3"
                >
                  Upload Scores
                </Link>
              </nav>
            </div>
          </header>
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
