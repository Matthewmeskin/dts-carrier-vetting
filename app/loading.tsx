import { Spinner } from '@/components/ui/Spinner'

// Shown by the App Router while a page's server work runs, so a route change
// never leaves the content column empty with the footer floating up.
export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-gray-500">
      <Spinner size={24} /> Loading…
    </div>
  )
}
