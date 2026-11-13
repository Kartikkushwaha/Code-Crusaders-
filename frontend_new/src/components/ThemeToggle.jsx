import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme.js";

/** Day / night switch. `floating` pins it to the top-right corner (sign-in screens). */
export default function ThemeToggle({ floating = false }) {
  const { theme, toggle } = useTheme();
  const day = theme === "light";
  return (
    <button
      onClick={toggle}
      aria-label={day ? "Switch to night mode" : "Switch to day mode"}
      title={day ? "Night mode" : "Day mode"}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-600 hover:text-white ${
        floating ? "fixed right-4 top-4 z-40 shadow-lg" : ""
      }`}
    >
      {day ? <Moon className="h-4 w-4" aria-hidden="true" /> : <Sun className="h-4 w-4 text-amber-300" aria-hidden="true" />}
      <span className={floating ? "" : "hidden xl:inline"}>{day ? "Night" : "Day"}</span>
    </button>
  );
}
