import { createSlice } from '@reduxjs/toolkit';

const THEME_KEY = 'sakha-theme';

const readTheme = () => {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* private browsing */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/**
 * Reducers here are pure. Persisting the theme and stamping it on <html> are
 * side effects, so they live in applyTheme(), which App calls from an effect
 * whenever the value changes. Doing it inside the reducer would fire twice
 * under StrictMode and makes the store untestable without a DOM.
 */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private browsing */
  }
}

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    theme: readTheme(),
    mobileNavOpen: false,
    toasts: [],
  },
  reducers: {
    setTheme(state, action) {
      state.theme = action.payload === 'dark' ? 'dark' : 'light';
    },
    toggleTheme(state) {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
    },
    setMobileNav(state, action) {
      state.mobileNavOpen = action.payload;
    },
    pushToast: {
      reducer(state, action) {
        state.toasts.push(action.payload);
      },
      prepare(message, tone = 'info') {
        return { payload: { id: `${Date.now()}-${Math.random()}`, message, tone } };
      },
    },
    dismissToast(state, action) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
  },
});

export const { setTheme, toggleTheme, setMobileNav, pushToast, dismissToast } = uiSlice.actions;
export default uiSlice.reducer;

export const selectTheme = (s) => s.ui.theme;
export const selectToasts = (s) => s.ui.toasts;
