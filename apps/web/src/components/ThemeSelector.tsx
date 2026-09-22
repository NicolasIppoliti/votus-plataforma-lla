"use client";

import { useSyncExternalStore } from "react";

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

// Desktop and drawer selectors share one browser preference, including when
// persistence is unavailable. A deterministic server snapshot avoids hydration drift.
let preference: Theme = THEME.SYSTEM;
let initialized = false;
const listeners = new Set<() => void>();
const getPreference = () => preference;
const getServerPreference = () => THEME.SYSTEM;

function notifyPreference() {
  applyTheme(preference);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  if (!initialized) {
    preference = readPreference();
    initialized = true;
  }
  listeners.add(listener);
  applyTheme(preference);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const updateSystem = () => {
    if (preference === THEME.SYSTEM) applyTheme(THEME.SYSTEM);
  };
  const updateStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    preference = readPreference();
    notifyPreference();
  };
  media.addEventListener("change", updateSystem);
  window.addEventListener("storage", updateStorage);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", updateSystem);
    window.removeEventListener("storage", updateStorage);
  };
}

export function ThemeSelector() {
  const selected = useSyncExternalStore(subscribe, getPreference, getServerPreference);
  return (
    <label className="theme-selector">
      Tema
      <select value={selected} onChange={(event) => {
        const value = event.currentTarget.value;
        if (value !== THEME.SYSTEM && value !== THEME.LIGHT && value !== THEME.DARK) return;
        preference = value;
        try {
          if (value === THEME.SYSTEM) localStorage.removeItem(STORAGE_KEY);
          else localStorage.setItem(STORAGE_KEY, value);
        } catch { /* Apply for this page even if persistence is blocked. */ }
        notifyPreference();
      }}>
        <option value={THEME.SYSTEM}>Sistema</option>
        <option value={THEME.LIGHT}>Claro</option>
        <option value={THEME.DARK}>Oscuro</option>
      </select>
    </label>
  );
}
