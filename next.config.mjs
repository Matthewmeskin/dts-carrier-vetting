/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Don't reuse the client Router Cache across navigations — returning to the
    // carrier list after visiting a carrier re-renders and re-fetches fresh
    // data instead of showing a stale snapshot. Saved filters and scroll are
    // restored from sessionStorage, so the view is preserved.
    staleTimes: { dynamic: 0, static: 0 },
  },
}

export default nextConfig
