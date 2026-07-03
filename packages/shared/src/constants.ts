export const DEFAULT_LANGUAGE = "C++";

export const SUPPORTED_LANGUAGES = ["C++", "Python", "Java", "JavaScript"] as const;

export const CHAT_MODES = [
  "explain_problem",
  "hint",
  "debug_code",
  "complexity_analysis",
  "optimal_solution",
  "dry_run",
  "edge_cases"
] as const;

export const API_BASE_URL = "http://localhost:4000/api";

export const HINT_LEVELS = [
  { level: 1, name: "Starting Hint" },
  { level: 2, name: "Coding Plan Hint" },
  { level: 3, name: "Algorithm Hint" }
] as const;

export const THEME_OPTIONS = ["system", "light", "dark"] as const;
