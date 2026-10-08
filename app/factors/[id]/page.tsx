import { redirect } from 'next/navigation'

// Factor pages live in the Payables portal now (see ../page.tsx).
export default function FactorMoved({ params }: { params: { id: string } }) {
  redirect(`https://dts-ap-portal.vercel.app/factors/${encodeURIComponent(params.id)}`)
}
