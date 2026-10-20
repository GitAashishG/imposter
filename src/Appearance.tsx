import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";
type Preference = Theme | "system";
const STORAGE_KEY = "ko-ho-theme";
const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(
  null,
);

function initialPreference(): Preference {
  const value = document.documentElement.dataset.themePreference;
  return value === "light" || value === "dark" ? value : "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Preference>(initialPreference);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const theme: Theme =
    preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => setSystemDark(media.matches);
    media.addEventListener("change", followSystem);
    return () => media.removeEventListener("change", followSystem);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = preference;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#131d19" : "#f6f3eb");
  }, [theme, preference]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const next = event.newValue;
      setPreference(next === "dark" || next === "light" ? next : "system");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setPreference(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* The choice still applies for the rest of this visit. */
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeToggle() {
  const appearance = useContext(ThemeContext);
  if (!appearance) throw new Error("ThemeToggle requires ThemeProvider.");
  const dark = appearance.theme === "dark";
  const label = `Switch to ${dark ? "light" : "dark"} mode`;
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={label}
      aria-pressed={dark}
      title={label}
      onClick={appearance.toggle}
    >
      {dark ? (
        <Sun size={19} aria-hidden="true" />
      ) : (
        <Moon size={19} aria-hidden="true" />
      )}
    </button>
  );
}
