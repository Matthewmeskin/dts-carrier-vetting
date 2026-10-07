import type { Config } from 'tailwindcss'

// Shared DTS look: the same palette, type and neutrals as the Payables hub and
// the other portals, so moving between them feels like one product.
const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // DTS brand palette (kept for existing utilities like text-dts-blue).
        dts: {
          maroon: '#AB0534',
          blue: '#0063A0',
          darkblue: '#33658A',
        },
        maroon: {
          DEFAULT: '#AB0534',
          50: '#FDF2F5',
          100: '#FBE4EA',
          200: '#F4BECC',
          600: '#AB0534',
          700: '#8A0429',
          800: '#6B031F',
        },
        brandblue: {
          DEFAULT: '#0063A0',
          50: '#F0F7FC',
          100: '#DDEDF7',
          200: '#B5D8EE',
          600: '#0063A0',
          700: '#004F80',
          800: '#003B60',
        },
        ink: {
          DEFAULT: '#1A1D21',
          muted: '#444C57',
          faint: '#6B7380',
        },
        line: '#E3E7EC',
        surface: '#F7F8FA',
      },
      fontFamily: {
        sans: ['var(--font-lato)', 'Lato', 'system-ui', 'sans-serif'],
        body: ['var(--font-lato)', 'Lato', 'system-ui', 'sans-serif'],
        heading: ['var(--font-montserrat)', 'Montserrat', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
}

export default config
