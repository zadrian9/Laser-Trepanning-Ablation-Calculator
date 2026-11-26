/**
 * FOUC-free light/dark theme persistence and root attribute synchronization.
 */

export type ThemeMode = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'trepan_theme';

export function getSavedTheme(
  storage: Pick<Storage, 'getItem'> | null | undefined = getDefaultStorage(),
  prefersLight = getSystemPrefersLight(),
): ThemeMode {
  if (storage) {
    try {
      const saved = storage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') {
        return saved;
      }
    } catch {
      // Ignore storage access errors (private browsing / restricted storage)
    }
  }
  return prefersLight ? 'light' : 'dark';
}

export function applyTheme(
  theme: ThemeMode,
  root: HTMLElement | null = typeof document !== 'undefined'
    ? document.documentElement
    : null,
  storage: Pick<Storage, 'setItem'> | null | undefined = getDefaultStorage(),
): ThemeMode {
  if (root) {
    root.setAttribute('data-theme', theme);
    if (root.style) {
      root.style.colorScheme = theme;
    }
  }
  if (storage) {
    try {
      storage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage write errors
    }
  }
  return theme;
}

export function toggleTheme(
  currentTheme: ThemeMode,
  root: HTMLElement | null = typeof document !== 'undefined'
    ? document.documentElement
    : null,
  storage: Pick<Storage, 'setItem'> | null | undefined = getDefaultStorage(),
): ThemeMode {
  const next: ThemeMode = currentTheme === 'dark' ? 'light' : 'dark';
  return applyTheme(next, root, storage);
}

function getDefaultStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function getSystemPrefersLight(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: light)').matches
    );
  } catch {
    return false;
  }
}
