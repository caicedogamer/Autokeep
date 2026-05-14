/*
 * Theme service — owns the operator's visual-theme preference.
 *
 * Per Constitution Principle III, all storage normally routes through
 * `StorageAdapter`. The theme preference is the SOLE documented exception
 * (see research.md R18): it is a non-secret, non-financial visual setting
 * that MUST apply on the unlock screen — i.e., BEFORE the encrypted
 * workspace is available. Routing it through the encrypted adapter would
 * create a chicken-and-egg loop.
 *
 * The preference is persisted under `autokeep:theme` and may take one of
 * three values:
 *   - `'system'` — follow `prefers-color-scheme` (default).
 *   - `'light'`  — force light.
 *   - `'dark'`   — force dark.
 *
 * Applying a theme = setting `<html data-theme="light|dark">`. When the
 * preference is `'system'` we observe the media query and refresh the
 * attribute on changes.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'autokeep:theme';
const PREFERENCES: ReadonlyArray<ThemePreference> = ['system', 'light', 'dark'] as const;

const isThemePreference = (value: unknown): value is ThemePreference =>
  typeof value === 'string' && (PREFERENCES as ReadonlyArray<string>).includes(value);

const readPersistedPreference = (): ThemePreference => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(raw) ? raw : 'system';
  } catch {
    // localStorage may be unavailable (privacy mode, file://). Fall back
    // to system without throwing.
    return 'system';
  }
};

const writePersistedPreference = (pref: ThemePreference): void => {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Quota or privacy-mode failure — preference still applies in-memory.
  }
};

const systemPrefersDark = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const resolveTheme = (pref: ThemePreference): ResolvedTheme => {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
};

const applyTheme = (resolved: ResolvedTheme): void => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
};

export interface ThemeService {
  /** Returns the operator's chosen preference (`'system'`, `'light'`, or `'dark'`). */
  getPreference(): ThemePreference;
  /** Returns the currently-applied theme (always resolved to `'light'` or `'dark'`). */
  getResolved(): ResolvedTheme;
  /** Updates the preference, persists it, and applies the resolved theme. */
  setPreference(pref: ThemePreference): void;
  /** Subscribe to resolved-theme changes. Returns an unsubscribe function. */
  subscribe(listener: (resolved: ResolvedTheme) => void): () => void;
  /** Cleans up the media-query listener. */
  dispose(): void;
}

export const createThemeService = (): ThemeService => {
  let preference: ThemePreference = readPersistedPreference();
  let resolved: ResolvedTheme = resolveTheme(preference);
  applyTheme(resolved);

  const listeners = new Set<(resolved: ResolvedTheme) => void>();

  const notify = (): void => {
    for (const listener of listeners) listener(resolved);
  };

  const mediaQuery: MediaQueryList | null =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  const onMediaChange = (event: MediaQueryListEvent): void => {
    if (preference !== 'system') return;
    const next: ResolvedTheme = event.matches ? 'dark' : 'light';
    if (next === resolved) return;
    resolved = next;
    applyTheme(resolved);
    notify();
  };

  if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onMediaChange);
  }

  return {
    getPreference: () => preference,
    getResolved: () => resolved,
    setPreference: (pref) => {
      if (pref === preference) return;
      preference = pref;
      writePersistedPreference(pref);
      const nextResolved = resolveTheme(pref);
      if (nextResolved !== resolved) {
        resolved = nextResolved;
        applyTheme(resolved);
        notify();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      if (mediaQuery && typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', onMediaChange);
      }
      listeners.clear();
    },
  };
};
