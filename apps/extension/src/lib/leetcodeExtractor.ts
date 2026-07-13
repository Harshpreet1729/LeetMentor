import type { ProblemContext, SupportedLanguage } from "@leetcode-assistant/shared";

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function pickFirstText(selectors: string[]): string {
  for (const selector of selectors) {
    const text = cleanText(document.querySelector(selector)?.textContent);
    if (text) {
      return text;
    }
  }
  return "";
}

function extractStatementText(): string {
  const directText = pickFirstText([
    '[data-track-load="description_content"]',
    '[data-cy="question-content"]',
    '[class*="description"]',
    ".elfjS",
    "article"
  ]);

  if (directText) {
    return directText;
  }

  const mainPanel = document.querySelector("div[class*='overflow-auto'], div[role='tabpanel']");
  return cleanText(mainPanel?.textContent);
}

function extractExamples(statement: string): string[] {
  return Array.from(statement.matchAll(/Example\s+\d+:\s*([\s\S]*?)(?=Example\s+\d+:|Constraints:|$)/gi)).map((match) =>
    cleanText(match[1])
  );
}

function extractConstraints(statement: string): string[] {
  const match = statement.match(/Constraints:\s*([\s\S]*)$/i);
  if (!match) {
    return [];
  }

  return match[1]
    .split(/\r?\n|[•·]/)
    .map((line) => cleanText(line))
    .filter(Boolean);
}

export function extractProblemFromPage(): ProblemContext | null {
  const jsonLdNode = document.querySelector('script[type="application/ld+json"]');
  const pathname = window.location.pathname;
  const pathParts = pathname.split("/").filter(Boolean);
  const problemsIndex = pathParts.indexOf("problems");
  const slug = problemsIndex >= 0 ? pathParts[problemsIndex + 1] : "";

  let title = pickFirstText([
    "div.text-title-large a",
    "div.text-title-large",
    "a[href*='/problems/'][class*='no-underline']",
    "h1 a",
    "h1",
    '[data-cy="question-title"]'
  ]);
  let statement = extractStatementText();

  if (jsonLdNode?.textContent) {
    try {
      const jsonLd = JSON.parse(jsonLdNode.textContent) as { name?: string; description?: string };
      title = title || cleanText(jsonLd.name);
      statement = statement || cleanText(jsonLd.description);
    } catch {
      // Ignore invalid JSON-LD and keep DOM fallback.
    }
  }

  if (!title || !slug) {
    return null;
  }

  const heading = title.match(/^(\d+)\.\s*(.+)$/);
  const questionFrontendId = heading?.[1] ?? "";
  const cleanTitle = heading?.[2] ?? title;
  const difficulty = cleanText(
    document.querySelector('[diff]')?.textContent ??
      Array.from(document.querySelectorAll("div, span")).find((node) => ["Easy", "Medium", "Hard"].includes(cleanText(node.textContent)))?.textContent
  );
  const tags = Array.from(
    new Set(
      Array.from(document.querySelectorAll("a[href*='/tag/'], a[href*='/topics/'], [class*='topic']"))
        .map((node) => cleanText(node.textContent))
        .filter(Boolean)
    )
  );

  return {
    title: cleanTitle,
    titleSlug: slug,
    questionFrontendId,
    difficulty: difficulty || "Unknown",
    tags,
    link: window.location.href,
    statement,
    examples: extractExamples(statement),
    constraints: extractConstraints(statement)
  };
}

function normalizeCodeLine(line: string): string {
  return line.replace(/\u00a0/g, " ").replace(/\u200b/g, "").replace(/\r/g, "");
}

function normalizeLanguage(raw: string | null | undefined): SupportedLanguage | null {
  const normalized = cleanText(raw).toLowerCase();
  if (normalized.includes("c++")) {
    return "C++";
  }
  if (normalized.includes("python")) {
    return "Python";
  }
  if (normalized.includes("javascript")) {
    return "JavaScript";
  }
  if (normalized.includes("java")) {
    return "Java";
  }
  return null;
}

export interface LiveEditorSnapshot {
  code: string;
  language: SupportedLanguage | null;
  isLikelyPartial: boolean;
}

function editorHasHiddenLines(): boolean {
  const scrollContainers = Array.from(
    document.querySelectorAll<HTMLElement>(".monaco-editor .monaco-scrollable-element, .cm-editor .cm-scroller")
  );
  return scrollContainers.some(
    (container) => container.clientHeight > 0 && container.scrollHeight > container.clientHeight + 4
  );
}

function extractMonacoCode(): string {
  const lineNodes = Array.from(document.querySelectorAll(".monaco-editor .view-lines .view-line"));
  if (!lineNodes.length) {
    return "";
  }

  return lineNodes
    .map((node) => normalizeCodeLine(node.textContent || ""))
    .join("\n")
    .trimEnd();
}

function extractCodeMirrorCode(): string {
  const lineNodes = Array.from(document.querySelectorAll(".cm-editor .cm-line"));
  if (!lineNodes.length) {
    return "";
  }

  return lineNodes
    .map((node) => normalizeCodeLine(node.textContent || ""))
    .join("\n")
    .trimEnd();
}

export async function extractLiveEditorSnapshotFromPage(): Promise<LiveEditorSnapshot> {
  const languageCandidates = [
    document.querySelector('[data-cy="lang-select"]')?.textContent,
    document.querySelector('button[id*="headlessui-listbox-button"]')?.textContent,
    document.querySelector(".monaco-editor")?.getAttribute("data-language"),
    document.querySelector(".cm-editor")?.getAttribute("data-language")
  ];

  const code = extractMonacoCode() || extractCodeMirrorCode();

  return {
    code,
    language: normalizeLanguage(languageCandidates.find(Boolean)),
    isLikelyPartial: Boolean(code) && editorHasHiddenLines()
  };
}
