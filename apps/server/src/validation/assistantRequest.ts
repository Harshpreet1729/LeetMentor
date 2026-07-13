import type { AssistantMode, AssistantRequest, ProblemContext, SupportedLanguage } from "@leetcode-assistant/shared";

const ASSISTANT_MODES = new Set<AssistantMode>([
  "hint",
  "explain",
  "debug",
  "complexity",
  "dry_run",
  "full_solution",
  "optimize"
]);

const SUPPORTED_LANGUAGES = new Set<SupportedLanguage>(["C++", "Python", "Java", "JavaScript"]);
const REQUEST_FIELDS = new Set(["mode", "problem", "userCode", "language", "userQuestion", "hintLevel"]);
const PROBLEM_FIELDS = new Set([
  "title",
  "titleSlug",
  "questionFrontendId",
  "difficulty",
  "tags",
  "link",
  "statement",
  "examples",
  "constraints",
  "acceptanceRate"
]);

const MAX_USER_QUESTION_LENGTH = 4_000;
const MAX_USER_CODE_LENGTH = 100_000;

type ValidationResult = { ok: true; value: AssistantRequest } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFields(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function readRequiredString(
  value: Record<string, unknown>,
  field: string,
  maxLength: number,
  allowEmpty = false
): string | null {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.length > maxLength || (!allowEmpty && !candidate.trim())) {
    return null;
  }
  return candidate;
}

function readStringArray(value: unknown, maxItems: number, maxItemLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) {
    return null;
  }

  if (!value.every((item) => typeof item === "string" && item.length <= maxItemLength)) {
    return null;
  }

  return value as string[];
}

function parseProblem(value: unknown): ProblemContext | null {
  if (!isRecord(value) || !hasOnlyFields(value, PROBLEM_FIELDS)) {
    return null;
  }

  const title = readRequiredString(value, "title", 300);
  const titleSlug = readRequiredString(value, "titleSlug", 300);
  const questionFrontendId = readRequiredString(value, "questionFrontendId", 30, true);
  const difficulty = readRequiredString(value, "difficulty", 30);
  const link = readRequiredString(value, "link", 2_000);
  const statement = readRequiredString(value, "statement", 100_000, true);
  const tags = readStringArray(value.tags, 50, 100);
  const examples = readStringArray(value.examples, 20, 10_000);
  const constraints = readStringArray(value.constraints, 100, 2_000);
  const acceptanceRate = value.acceptanceRate;

  if (
    title === null ||
    titleSlug === null ||
    questionFrontendId === null ||
    difficulty === null ||
    link === null ||
    statement === null ||
    tags === null ||
    examples === null ||
    constraints === null ||
    (acceptanceRate !== undefined &&
      (typeof acceptanceRate !== "number" || !Number.isFinite(acceptanceRate) || acceptanceRate < 0 || acceptanceRate > 100))
  ) {
    return null;
  }

  return {
    title,
    titleSlug,
    questionFrontendId,
    difficulty,
    tags,
    link,
    statement,
    examples,
    constraints,
    ...(typeof acceptanceRate === "number" ? { acceptanceRate } : {})
  };
}

export function parseAssistantRequest(value: unknown): ValidationResult {
  if (!isRecord(value) || !hasOnlyFields(value, REQUEST_FIELDS)) {
    return { ok: false, message: "Request body must be an object with known assistant fields." };
  }

  if (typeof value.mode !== "string" || !ASSISTANT_MODES.has(value.mode as AssistantMode)) {
    return { ok: false, message: "Mode must be a supported assistant mode." };
  }
  const mode = value.mode as AssistantMode;

  if (value.language !== undefined && (typeof value.language !== "string" || !SUPPORTED_LANGUAGES.has(value.language as SupportedLanguage))) {
    return { ok: false, message: "Language must be one of C++, Python, Java, or JavaScript." };
  }

  if (
    value.hintLevel !== undefined &&
    (typeof value.hintLevel !== "number" || !Number.isInteger(value.hintLevel) || value.hintLevel < 1 || value.hintLevel > 3)
  ) {
    return { ok: false, message: "Hint level must be an integer from 1 to 3." };
  }

  if (value.userQuestion !== undefined && (typeof value.userQuestion !== "string" || value.userQuestion.length > MAX_USER_QUESTION_LENGTH)) {
    return { ok: false, message: `User question must be at most ${MAX_USER_QUESTION_LENGTH} characters.` };
  }

  if (value.userCode !== undefined && (typeof value.userCode !== "string" || value.userCode.length > MAX_USER_CODE_LENGTH)) {
    return { ok: false, message: `User code must be at most ${MAX_USER_CODE_LENGTH} characters.` };
  }

  let problem: ProblemContext | null | undefined;
  if (value.problem === null) {
    problem = null;
  } else if (value.problem !== undefined) {
    problem = parseProblem(value.problem);
    if (!problem) {
      return { ok: false, message: "Problem context is malformed or exceeds the allowed size." };
    }
  }

  return {
    ok: true,
    value: {
      mode,
      ...(problem !== undefined ? { problem } : {}),
      ...(typeof value.userCode === "string" ? { userCode: value.userCode } : {}),
      ...(typeof value.language === "string" ? { language: value.language as SupportedLanguage } : {}),
      ...(typeof value.userQuestion === "string" ? { userQuestion: value.userQuestion } : {}),
      ...(typeof value.hintLevel === "number" ? { hintLevel: value.hintLevel } : {})
    }
  };
}
