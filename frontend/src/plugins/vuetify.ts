import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import { pt } from 'vuetify/locale';

const THEME_KEY = 'fiapx.theme';

export function savedTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage indisponível */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function persistTheme(theme: 'light' | 'dark') {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage indisponível */
  }
}

const brand = {
  primary: '#ED145B',
  secondary: '#5B6475',
  success: '#15803D',
  warning: '#B45309',
  error: '#B91C1C',
  info: '#2563EB',
};

export const vuetify = createVuetify({
  locale: { locale: 'pt', messages: { pt } },
  theme: {
    defaultTheme: savedTheme(),
    themes: {
      light: { dark: false, colors: { ...brand, background: '#F4F5F7', surface: '#FFFFFF' } },
      dark: {
        dark: true,
        colors: {
          ...brand,
          success: '#4ADE80',
          warning: '#FBBF24',
          error: '#F87171',
          background: '#0F1115',
          surface: '#171A20',
        },
      },
    },
  },
  defaults: {
    VBtn: { rounded: 'lg' },
    VCard: { rounded: 'lg' },
    VTextField: { variant: 'outlined', density: 'comfortable' },
  },
});
