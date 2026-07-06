export const THEME_KEY = "binance_candle_theme";

export function getStoredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "day" || saved === "night" ? saved : "night";
  } catch {
    return "night";
  }
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function toggleTheme(current) {
  const next = current === "day" ? "night" : "day";
  applyTheme(next);
  return next;
}

export const CHART_THEMES = {
  day: {
    background: "#ffffff",
    textColor: "#334155",
    grid: "#e2e8f0",
    border: "#cbd5e1",
  },
  night: {
    background: "#16181c",
    textColor: "#94a3b8",
    grid: "#2f3336",
    border: "#2f3336",
  },
};
