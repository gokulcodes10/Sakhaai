/**
 * The design system.
 *
 * Colours are declared as CSS custom properties in styles/index.css and merely
 * referenced here, so a single :root block controls light and dark, and the CMS
 * could one day expose a theme without a rebuild.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          ink: 'rgb(var(--accent-ink) / <alpha-value>)',
        },
        trust: {
          DEFAULT: 'rgb(var(--trust) / <alpha-value>)',
          soft: 'rgb(var(--trust-soft) / <alpha-value>)',
        },
        keystone: 'rgb(var(--keystone) / <alpha-value>)',
        iris: 'rgb(var(--iris) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
      },
      fontFamily: {
        // One family; headings differ by weight 600 and negative tracking.
        display: ['Archivo', 'system-ui', 'sans-serif'],
        sans: ['Archivo', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // A modular scale (1.25) rather than Tailwind's defaults, so headings
        // relate to each other instead of being picked one at a time.
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.04em' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.875rem', { lineHeight: '1.375rem' }],
        base: ['1rem', { lineHeight: '1.65' }],
        lg: ['1.125rem', { lineHeight: '1.6' }],
        xl: ['1.375rem', { lineHeight: '1.45' }],
        '2xl': ['1.75rem', { lineHeight: '1.3', letterSpacing: '-0.015em' }],
        '3xl': ['2.25rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        '4xl': ['3rem', { lineHeight: '1.08', letterSpacing: '-0.025em' }],
        '5xl': ['3.75rem', { lineHeight: '1.03', letterSpacing: '-0.03em' }],
        '6xl': ['4.5rem', { lineHeight: '1', letterSpacing: '-0.035em' }],
      },
      spacing: {
        18: '4.5rem',
        22: '5.5rem',
        26: '6.5rem',
        30: '7.5rem',
      },
      maxWidth: {
        prose: '68ch',
        shell: '78rem',
      },
      borderRadius: {
        sm: '0.3125rem', // 5px badges, chips
        DEFAULT: '0.4375rem', // 7px buttons
        md: '0.5625rem', // 9px list items
        lg: '0.875rem', // 14px cards
        xl: '1.75rem', // 28px hero panel
      },
      boxShadow: {
        subtle: '0 1px 2px rgb(var(--shadow) / 0.05), 0 1px 3px rgb(var(--shadow) / 0.04)',
        card: '0 2px 4px rgb(var(--shadow) / 0.04), 0 8px 24px -8px rgb(var(--shadow) / 0.10)',
        lift: '0 4px 8px rgb(var(--shadow) / 0.05), 0 16px 40px -12px rgb(var(--shadow) / 0.16)',
        panel: '-1px 0 0 rgb(var(--line) / 1), -8px 0 32px -12px rgb(var(--shadow) / 0.14)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-in': 'slide-in 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-dot': 'pulse-dot 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
