import { redirect } from 'next/navigation'

// The factor registry (approval + Secretary-of-State checks) moved to the
// Payables portal, where the people who pay factors work. Old links follow.
export default function FactorsMoved() {
  redirect('https://dts-ap-portal.vercel.app/factors')
}
