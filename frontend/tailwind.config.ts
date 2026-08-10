import type { Config } from 'tailwindcss';

/**
 * Every colour resolves to a CSS variable declared in globals.css, so the
 * light and dark themes swap with one attribute on <html> instead of a
 * second set of utility classes.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        ink: 'var(--text)',
        'ink-2': 'var(--text-2)',
        'ink-3': 'var(--text-3)',
        brand: {
          DEFAULT: '#2563EB',
          dark: '#1D4ED8',
          soft: 'var(--blue-50)',
          border: 'var(--blue-200)',
        },
        ok: { DEFAULT: '#16A34A', soft: 'var(--green-soft)' },
        warn: { DEFAULT: '#D97706', soft: 'var(--amber-soft)' },
        danger: { DEFAULT: '#DC2626', soft: 'var(--red-soft)' },
        violet: { DEFAULT: '#7C3AED', soft: 'var(--violet-soft)' },
      },
      borderRadius: { lg: '16px', md: '10px', sm: '8px', xl: '20px' },
      boxShadow: {
        e1: 'var(--shadow-1)',
        e2: 'var(--shadow-2)',
        e3: 'var(--shadow-3)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      transitionDuration: { DEFAULT: '200ms' },
      keyframes: {
        fade: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'none' } },
        shimmer: { '0%': { backgroundPosition: '100% 50%' }, '100%': { backgroundPosition: '0 50%' } },
        ping2: { '0%': { transform: 'scale(.7)', opacity: '.6' }, '100%': { transform: 'scale(1.5)', opacity: '0' } },
        toastIn: { '0%': { opacity: '0', transform: 'translateX(16px) scale(.97)' }, '100%': { opacity: '1', transform: 'none' } },
      },
      animation: {
        fade: 'fade .28s cubic-bezier(.4,0,.2,1)',
        shimmer: 'shimmer 1.3s ease infinite',
        ping2: 'ping2 1.8s cubic-bezier(0,0,.2,1) infinite',
        toastIn: 'toastIn .3s cubic-bezier(.2,.9,.3,1)',
      },
    },
  },
  plugins: [],
};

export default config;
