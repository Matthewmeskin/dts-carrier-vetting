import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

// Shared DTS look: the same palette, type and neutrals as the Payables hub and
// the other portals, so moving between them feels like one product.
const config: Config = {
  // The `dark` class on <html> is set before paint by the inline script in
  // app/layout.tsx and switched by components/ThemeToggle.tsx — the same
  // mechanism as the Payables hub.
  darkMode: 'class',
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
        // The neutrals are CSS variables (rgb channels, so opacity modifiers
        // like border-line/70 keep working); their light and dark values live
        // in app/globals.css.
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        surface: 'rgb(var(--surface) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
        // A card or panel: white in light, a raised slate in dark.
        card: 'rgb(var(--card) / <alpha-value>)',
      },
      // What a bare `border` draws with: the line token, so an uncolored
      // border is a hairline in dark too, not light grey.
      borderColor: {
        DEFAULT: 'rgb(var(--line))',
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
  plugins: [
    // `rail:` applies while the desktop sidebar is folded to its icon rail
    // (the `sb-collapsed` class on <html>, see components/sidebarState.ts).
    plugin(({ addVariant }) => addVariant('rail', '@media (min-width: 1024px) { .sb-collapsed & }')),
  ],
}

export default config
