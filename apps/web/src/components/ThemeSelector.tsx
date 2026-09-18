"use client";

import { useEffect, useRef } from "react";

const THEME = { SYSTEM: "system", LIGHT: "light", DARK: "dark" } as const;
type Theme = (typeof THEME)[keyof typeof THEME];
const STORAGE_KEY = "votus-theme";

function readPreference(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === THEME.LIGHT || stored === THEME.DARK) return stored;
  } catch { /* Storage can be unavailable; System remains usable. */ }
  return THEME.SYSTEM;
}

function applyTheme(preference: Theme) {
  const effective = preference === THEME.SYSTEM
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? THEME.DARK : THEME.LIGHT
    : preference;
  document.documentElement.dataset.theme = effective;
  document.documentElement.style.colorScheme = effective;
}

export function ThemeSelector() {
  const select = useRef<HTMLSelectElement>(null);
  const preference = useRef<Theme>(THEME.SYSTEM);

  useEffect(() => {
    preference.current = readPreference();
    if (select.current) select.current.value = preference.current;
    applyTheme(preference.current);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystem = () => {
      if (preference.current === THEME.SYSTEM) applyTheme(THEME.SYSTEM);
    };
    media.addEventListener("change", updateSystem);
    return () => media.removeEventListener("change", updateSystem);
  }, []);

  return (
    <label className="theme-selector">
      Tema
      <select ref={select} defaultValue={THEME.SYSTEM} onChange={(event) => {
        const value = event.currentTarget.value;
        if (value !== THEME.SYSTEM && value !== THEME.LIGHT && value !== THEME.DARK) return;
        preference.current = value;
        try {
          if (value === THEME.SYSTEM) localStorage.removeItem(STORAGE_KEY);
          else localStorage.setItem(STORAGE_KEY, value);
        } catch { /* Apply for this page even if persistence is blocked. */ }
        applyTheme(value);
      }}>
        <option value={THEME.SYSTEM}>Sistema</option>
        <option value={THEME.LIGHT}>Claro</option>
        <option value={THEME.DARK}>Oscuro</option>
      </select>
    </label>
  );
}
