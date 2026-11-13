// Day / night mode. Night (dark) is the default design; day mode is the html.light layer in index.css.
// The choice is remembered per browser.
import { useCallback, useSyncExternalStore } from "react";

const KEY = "publivra.theme";
const EVENT = "publivra-theme";

function read() {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Apply the saved theme to <html>. Called once before React renders, so pages never flash. */
export function applyTheme(theme = read()) {
  document.documentElement.classList.toggle("light", theme === "light");
  document.documentElement.style.colorScheme = theme;
}

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: still switch for this visit */
  }
  const root = document.documentElement;
  root.classList.add("theme-anim");
  applyTheme(theme);
  window.setTimeout(() => root.classList.remove("theme-anim"), 300);
  window.dispatchEvent(new Event(EVENT));
}

const subscribe = (fn) => {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};
const current = () => (document.documentElement.classList.contains("light") ? "light" : "dark");

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => "dark");
  const toggle = useCallback(() => setTheme(current() === "light" ? "dark" : "light"), []);
  return { theme, toggle };
}
