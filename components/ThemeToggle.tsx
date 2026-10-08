'use client'

import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'

/**
 * Light, dark, or whatever the OS says — the same control as the Payables
 * hub. The choice lives in localStorage under 'theme' (absent means
 * 'system'); the `dark` class on <html> is what the CSS reads. The inline
 * script in app/layout.tsx sets that class before first paint from the same
 * key, so a page never flashes the wrong theme; everything here keeps it
 * right afterwards.
 */
export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'theme'
/** Same-tab notice that the choice changed; `storage` covers other tabs. */
const EVENT = 'dts-theme-change'
const QUERY = '(prefers-color-scheme: dark)'

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function applyTheme(choice: ThemeChoice = readChoice()) {
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia(QUERY).matches)
  document.documentElement.classList.toggle('dark', dark)
}

function setChoice(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Storage blocked (private mode, policy): the theme still switches for
    // this page view, it just will not be remembered.
  }
  applyTheme(choice)
  window.dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** The stored choice; 'system' on the server and during hydration. */
function useThemeChoice() {
  return useSyncExternalStore(subscribe, readChoice, () => 'system' as ThemeChoice)
}

/**
 * Mounted once in the root layout, on every page. Re-applies the class after
 * React's dev-mode remount resets <html> attributes, follows the OS while the
 * choice is 'system', and picks up a change made in another tab.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme()
  }, [])

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const sync = () => applyTheme()
    mq.addEventListener('change', sync)
    window.addEventListener('storage', sync)
    return () => {
      mq.removeEventListener('change', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return null
}

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function Icon({ choice }: { choice: ThemeChoice }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (choice === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    )
  }
  if (choice === 'dark') {
    return (
      <svg {...common}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  )
}

/**
 * The theme control. `segmented` (the sidebar) shows all three choices;
 * `compact` (the phone header, where width is short) is one button that
 * steps System -> Light -> Dark and shows the current one.
 */
export function ThemeToggle({ variant = 'segmented' }: { variant?: 'segmented' | 'compact' }) {
  const choice = useThemeChoice()

  if (variant === 'compact') {
    const i = OPTIONS.findIndex((o) => o.value === choice)
    const next = OPTIONS[(i + 1) % OPTIONS.length]
    const label = `Theme: ${OPTIONS[i].label}. Switch to ${next.label}`
    return (
      <button
        type="button"
        onClick={() => setChoice(next.value)}
        title={label}
        aria-label={label}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-line text-ink-muted transition hover:text-ink print:hidden"
      >
        <Icon choice={choice} />
      </button>
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-px rounded border border-line p-px print:hidden"
    >
      {OPTIONS.map((o) => {
        const on = o.value === choice
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={o.label}
            onClick={() => setChoice(o.value)}
            className={[
              'flex h-6 w-7 items-center justify-center rounded-sm transition',
              on ? 'bg-ink/10 text-ink' : 'text-ink-faint hover:text-ink',
            ].join(' ')}
          >
            <Icon choice={o.value} />
          </button>
        )
      })}
    </div>
  )
}
