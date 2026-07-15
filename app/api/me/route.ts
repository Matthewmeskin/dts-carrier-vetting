import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/authServer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — the current signed-in user's email + role (for the header/user menu).
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ user: null }, { status: 401 })
  return NextResponse.json({
    user: { email: user.email, role: user.role, fullName: user.fullName },
  })
}
