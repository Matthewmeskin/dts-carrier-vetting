'use client'

import { useSyncExternalStore } from 'react'

/**
 * Whether the desktop sidebar is folded to an icon rail. The choice lives in
 * localStorage under 'sidebar' ('collapsed', or absent for open); the
 * `sb-collapsed` class on <html> is what the CSS reads (the `rail:` Tailwind
 * variant). The inline script in app/layout.tsx sets that class before
 * first paint from the same key, so a folded menu never flashes open.
 */
const KEY = 'sidebar'
const CLASS = 'sb-collapsed'
const EVENT = 'dts-sidebar-change'

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === 'collapsed'
  } catch {
    return false
  }
}

export function applySidebarCollapsed(collapsed: boolean = readSidebarCollapsed()) {
  document.documentElement.classList.toggle(CLASS, collapsed)
}

export function setSidebarCollapsed(collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(KEY, 'collapsed')
    else localStorage.removeItem(KEY)
  } catch {
    // Storage blocked: the menu still folds for this page view.
  }
  applySidebarCollapsed(collapsed)
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

/** The stored choice; open on the server and during hydration. */
export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, readSidebarCollapsed, () => false)
}
