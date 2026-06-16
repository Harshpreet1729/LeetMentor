export type SupportedLanguage = "C++" | "Python" | "Java" | "JavaScript";

export type AssistantMode =
  | "hint"
  | "explain"
  | "debug"
  | "complexity"
  | "dry_run"
  | "full_solution"
  | "optimize";

export type ThemeMode = "system" | "light" | "dark";

export interface ProblemContext {
  title: string;
  titleSlug: string;
  questionFrontendId: string;
  difficulty: string;
  tags: string[];
  link: string;
  statement: string;
  examples: string[];
  constraints: string[];
  acceptanceRate?: number;
}

export interface AssistantRequest {
  mode: AssistantMode;
  problem?: ProblemContext | null;
  userCode?: string;
  language?: SupportedLanguage;
  userQuestion?: string;
  hintLevel?: number;
}

export interface AssistantResponse {
  answer: string;
  complexity?: {
    time: string;
    space: string;
  };
  suggestedNextStep?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  mode?: AssistantMode;
}

export interface UserPreferences {
  language: SupportedLanguage;
  theme: ThemeMode;
  model: string;
}

export interface CachedProblemEntry {
  identifier: string;
  problem: ProblemContext;
  cachedAt: string;
}
