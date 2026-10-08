// The DTS logo from /public: the light version has black lettering, the dark
// one white, and the `dark` class on <html> (see ThemeToggle) picks which.
export function Logo({ className }: { className?: string }) {
  const alt = 'DTS — Diversified Transportation Services'
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/dts-logo.png" alt={alt} className={`${className ?? ''} dark:hidden`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/dts-logo-dark.png" alt={alt} className={`${className ?? ''} hidden dark:block`} />
    </>
  )
}
