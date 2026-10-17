import React, { createContext, useContext, useEffect, useState } from 'react';

// Sama seperti app lain: toggle terang/gelap, tersimpan di localStorage, bawaan ikut sistem.
const KEY = 'telur-erp-theme';
const Ctx = createContext(null);

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* mode privat */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initial);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem(KEY, theme); } catch { /* abaikan */ }
  }, [theme]);
  return <Ctx.Provider value={{ theme, toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);

export function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme} title={theme === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'}
      className={`whitespace-nowrap rounded-md px-2 py-1 text-sm text-brand-100 transition-colors hover:bg-brand-600/50 hover:text-white ${className}`}>
      {theme === 'dark' ? '☀️ Terang' : '🌙 Gelap'}
    </button>
  );
}

// "MAJOR.MINOR.PATCH" → "vMAJOR.MINOR" (konvensi semua app: x = perubahan besar, y = kecil/bug).
export const formatVersion = (full) => {
  if (!full) return 'v?';
  const [major, minor] = String(full).split('.');
  return `v${major}.${minor}`;
};
