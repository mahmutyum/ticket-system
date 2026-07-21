import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: 'rgb(var(--color-primary-50) / <alpha-value>)',
          100: 'rgb(var(--color-primary-100) / <alpha-value>)',
          200: 'rgb(var(--color-primary-200) / <alpha-value>)',
          300: 'rgb(var(--color-primary-300) / <alpha-value>)',
          400: 'rgb(var(--color-primary-400) / <alpha-value>)',
          500: 'rgb(var(--color-primary-500) / <alpha-value>)',
          600: 'rgb(var(--color-primary-600) / <alpha-value>)',
          700: 'rgb(var(--color-primary-700) / <alpha-value>)',
          800: 'rgb(var(--color-primary-800) / <alpha-value>)',
          900: 'rgb(var(--color-primary-900) / <alpha-value>)',
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      borderRadius: {
        control: '0.375rem',
        inset: '0.5rem',
        surface: '0.625rem',
        overlay: '0.75rem',
      },
      boxShadow: {
        surface: '0 1px 2px rgb(15 23 42 / 0.04), 0 3px 10px -4px rgb(15 23 42 / 0.10)',
        raised: '0 8px 24px -12px rgb(15 23 42 / 0.24)',
        overlay: '0 20px 48px -20px rgb(15 23 42 / 0.32)',
        soft: '0 1px 2px rgb(15 23 42 / 0.04), 0 3px 10px -4px rgb(15 23 42 / 0.10)',
        glow: '0 0 0 1px rgb(var(--color-primary-500) / 0.15), 0 8px 24px -8px rgb(var(--color-primary-500) / 0.35)',
      },
    },
  },
  plugins: [],
} satisfies Config;
