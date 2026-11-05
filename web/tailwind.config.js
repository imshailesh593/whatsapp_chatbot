/** @type {import('tailwindcss').Config} */
// Colours are semantic tokens (see src/index.css): the same class reads correctly in the light and the dark theme.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        app: token('app'),
        card: token('card'),
        sunken: token('sunken'),
        subtle: token('subtle'),
        line: token('line'),
        'line-strong': token('line-strong'),
        fg: token('fg'),
        fg2: token('fg2'),
        muted: token('muted'),
        brand: token('brand'),
        'brand-strong': token('brand-strong'),
        'brand-soft': token('brand-soft'),
        'brand-text': token('brand-text'),
        'on-brand': token('on-brand'),
        danger: token('danger'),
        'danger-soft': token('danger-soft'),
        'danger-line': token('danger-line'),
        warn: token('warn'),
        'warn-soft': token('warn-soft'),
        'warn-line': token('warn-line'),
        info: token('info'),
        'info-soft': token('info-soft'),
        'info-line': token('info-line'),
        violet: token('violet'),
        'violet-soft': token('violet-soft'),
        'violet-line': token('violet-line')
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow) / 0.05), 0 1px 3px rgb(var(--shadow) / 0.04)',
        pop: '0 10px 30px -8px rgb(var(--shadow) / 0.18), 0 4px 10px -4px rgb(var(--shadow) / 0.08)'
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' }
    }
  },
  plugins: []
};
