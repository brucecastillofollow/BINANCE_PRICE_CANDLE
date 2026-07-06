import { useEffect, useState } from "react";
import { applyTheme, getStoredTheme, toggleTheme } from "../lib/theme.js";

export default function ThemeToggle({ className = "" }) {
  const [theme, setTheme] = useState(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <button
      type="button"
      className={`secondary theme-toggle ${className}`.trim()}
      aria-label="Toggle day or night theme"
      onClick={() => setTheme((current) => toggleTheme(current))}
    >
      {theme === "day" ? "☀️ Day" : "🌙 Night"}
    </button>
  );
}
