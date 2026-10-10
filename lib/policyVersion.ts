// The adopted vetting policy version everyone must acknowledge (Policy
// Section 11). Unset until the policy is signed; set NEXT_PUBLIC_POLICY_VERSION
// (e.g. "7.0") and NEXT_PUBLIC_POLICY_URL at adoption to start asking.
export const POLICY_VERSION = process.env.NEXT_PUBLIC_POLICY_VERSION || ''
export const POLICY_URL = process.env.NEXT_PUBLIC_POLICY_URL || ''
