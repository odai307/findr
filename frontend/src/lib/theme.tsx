import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeSetting = 'light' | 'dark' | 'system';
const KEY = 'findr.theme';

/** The saved theme, or 'system'. Storage can be unavailable (private mode), so reads never throw. */
export function readTheme(): ThemeSetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark() {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  );
}

/** Puts `.dark` on <html> when the resolved theme is dark. */
export function applyTheme(setting: ThemeSetting) {
  const dark = setting === 'dark' || (setting === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

const ThemeContext = createContext<{ theme: ThemeSetting; setTheme: (t: ThemeSetting) => void }>({
  theme: 'system',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeSetting>(readTheme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    // Follow the operating system while on "system".
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq?.addEventListener('change', onChange);
    return () => mq?.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = (next: ThemeSetting) => {
    setThemeState(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Not saved; applies for this visit only.
    }
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
