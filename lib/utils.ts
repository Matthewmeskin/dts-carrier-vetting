import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO, isValid, differenceInDays } from 'date-fns'

/** Merge Tailwind classes with conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Coerce any incoming date-ish value into a Date or null. */
function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return isValid(value) ? value : null
  if (typeof value === 'number') {
    const d = new Date(value)
    return isValid(d) ? d : null
  }
  // string
  let d = parseISO(value)
  if (!isValid(d)) d = new Date(value)
  return isValid(d) ? d : null
}

/** Format a date as e.g. "Jun 22, 2026". Returns dash for empty/invalid. */
export function formatDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  return d ? format(d, 'MMM d, yyyy') : '—'
}

/** Format a date+time as e.g. "Jun 22, 2026 3:45 PM". */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  return d ? format(d, 'MMM d, yyyy h:mm a') : '—'
}

/** Relative time, e.g. "3 days ago". */
export function formatRelative(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  return d ? `${formatDistanceToNow(d)} ago` : '—'
}

/** Whole-day difference from now (positive = future). */
export function daysUntil(value: string | number | Date | null | undefined): number | null {
  const d = toDate(value)
  return d ? differenceInDays(d, new Date()) : null
}

/** Whole-day age in days (positive = past). */
export function daysSince(value: string | number | Date | null | undefined): number | null {
  const d = toDate(value)
  return d ? differenceInDays(new Date(), d) : null
}

/** Format a number as USD currency. */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

/** Format a numeric score with up to two decimals, or dash. */
export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/** Format a US phone number as (xxx) xxx-xxxx; returns the raw value if it
 * doesn't look like a 10-digit (or 1+10) number. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '—'
  const digits = value.replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (ten.length === 10) {
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  }
  return value
}
