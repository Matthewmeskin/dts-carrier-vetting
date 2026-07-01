import type { Metadata } from 'next'
import Link from 'next/link'
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
          <header className="bg-dts-maroon text-white shadow">
            <div className="mx-auto max-w-[1400px] px-6 py-3 flex items-center justify-between">
              <Link href="/carriers" className="flex items-center gap-3">
                <span className="text-lg font-bold tracking-tight">DTS</span>
                <span className="text-sm opacity-90">
                  Carrier Compliance Portal
                </span>
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link
                  href="/carriers"
                  className="rounded px-3 py-1.5 hover:bg-white/10 transition"
                >
                  Carriers
                </Link>
                <Link
                  href="/changes"
                  className="rounded px-3 py-1.5 hover:bg-white/10 transition"
                >
                  Changes
                </Link>
                <Link
                  href="/upload"
                  className="rounded px-3 py-1.5 hover:bg-white/10 transition"
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
