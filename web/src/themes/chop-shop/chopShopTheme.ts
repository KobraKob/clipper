import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme, neutralIconRegistry } from '@astryxdesign/theme-neutral';

export const chopShopTheme = defineTheme({
  extends: neutralTheme,
  name: 'chop-shop',
  icons: neutralIconRegistry,

  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: {
      family: 'Figtree',
      fallbacks:
        'var(--font-figtree), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    heading: {
      family: 'Barlow Condensed',
      fallbacks:
        'var(--font-barlow), Figtree, Impact, -apple-system, BlinkMacSystemFont, sans-serif',
      weights: { 1: 'bold', 2: 'bold', 3: 'bold', 4: 'bold' },
    },
    code: {
      family: 'ui-monospace',
      fallbacks:
        '"SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
  },

  motion: {
    tempo: 1.1,
    character: 'crisp',
  },

  tokens: {
    '--color-background-body': ['#f4f6fb', '#08090d'],
    '--color-background-surface': ['#ffffff', '#0f1118'],
    '--color-background-card': ['#ffffff', '#141824'],
    '--color-background-popover': ['#ffffff', '#1a1f2e'],
    '--color-background-muted': ['#ebeff7', '#0b0d14'],

    '--color-accent': ['#4f46e5', '#6366f1'],
    '--color-accent-muted': ['#e0e7ff', 'rgba(99, 102, 241, 0.2)'],
    '--color-text-accent': ['#4338ca', '#a5b4fc'],
    '--color-icon-accent': ['#4f46e5', '#818cf8'],
    '--color-on-accent': ['#ffffff', '#ffffff'],

    '--color-text-primary': ['#0f172a', '#f8fafc'],
    '--color-text-secondary': ['#475569', '#94a3b8'],
    '--color-text-disabled': ['#94a3b8', '#475569'],

    '--color-border': ['rgba(15, 23, 42, 0.1)', 'rgba(255, 255, 255, 0.09)'],
    '--color-border-emphasized': [
      'rgba(15, 23, 42, 0.22)',
      'rgba(255, 255, 255, 0.2)',
    ],

    '--color-info': ['#0284c7', '#06b6d4'],
    '--color-info-muted': ['#e0f2fe', 'rgba(6, 182, 212, 0.16)'],
    '--color-text-info': ['#0369a1', '#67e8f9'],
    '--color-on-info': ['#ffffff', '#042f2e'],
    '--color-on-info-muted': ['#0369a1', '#67e8f9'],

    '--color-success': ['#059669', '#10b981'],
    '--color-success-muted': ['#d1fae5', 'rgba(16, 185, 129, 0.16)'],
    '--color-text-success': ['#047857', '#6ee7b7'],
    '--color-on-success': ['#ffffff', '#022c22'],
    '--color-on-success-muted': ['#047857', '#6ee7b7'],

    '--color-warning': ['#d97706', '#f59e0b'],
    '--color-warning-muted': ['#fef3c7', 'rgba(245, 158, 11, 0.16)'],
    '--color-text-warning': ['#b45309', '#fcd34d'],
    '--color-on-warning': ['#ffffff', '#1c1917'],
    '--color-on-warning-muted': ['#b45309', '#fcd34d'],

    '--color-error': ['#e11d48', '#f43f5e'],
    '--color-error-muted': ['#ffe4e6', 'rgba(244, 63, 94, 0.18)'],
    '--color-text-error': ['#be123c', '#fda4af'],
    '--color-on-error': ['#ffffff', '#ffffff'],
    '--color-on-error-muted': ['#be123c', '#fda4af'],

    '--radius-none': '0px',
    '--radius-inner': '0.375rem',
    '--radius-element': '0.625rem',
    '--radius-container': '0.875rem',
    '--radius-page': '1.75rem',
    '--radius-full': '9999px',
  },

  components: {
    card: {
      base: {
        padding: 'var(--spacing-4)',
      },
    },
    section: {
      base: {
        padding: 'var(--spacing-4)',
      },
    },
    heading: {
      'type:display-1': {
        letterSpacing: '-0.03em',
        textTransform: 'uppercase',
      },
      'type:display-2': {
        letterSpacing: '-0.025em',
        textTransform: 'uppercase',
      },
      'type:display-3': {
        letterSpacing: '-0.02em',
      },
    },
    text: {
      'type:display-1': {
        letterSpacing: '-0.03em',
        textTransform: 'uppercase',
      },
      'type:display-2': {
        letterSpacing: '-0.025em',
        textTransform: 'uppercase',
      },
      'type:display-3': {
        letterSpacing: '-0.02em',
      },
    },
  },
});
