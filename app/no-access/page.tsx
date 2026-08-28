export const dynamic = 'force-dynamic'

/**
 * The account is real and signed in — this particular portal just has not
 * been granted to it. Access is set per app on the DTS Operations Users
 * page; this page is what "No access" for Carrier Vetting actually looks
 * like, rather than a login loop.
 */
export default function NoAccessPage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-lg border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <h1 className="text-base font-semibold text-slate-900">
          Carrier Vetting is not open to this account
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Your login works — this portal just has not been granted to you. An admin can switch it on
          from the Users page on DTS Operations in a couple of seconds.
        </p>
        <a
          href="https://dts-ap-portal.vercel.app/"
          className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline"
        >
          ← Back to all portals
        </a>
      </div>
    </main>
  )
}
