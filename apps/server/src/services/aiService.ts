import type { AssistantRequest, AssistantResponse } from "@leetcode-assistant/shared";
import { assistantSystemPrompt } from "../prompts/systemPrompt.js";

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TIMEOUT_MS = 45_000;

const modeGuidance: Record<AssistantRequest["mode"], string> = {
  hint:
    "Give a progressive, practical coaching hint only. Ground it in the actual problem statement, examples, and constraints. Tell the student what to notice, what to try next, and how to check they are on track. Do not reveal full code.",
  explain: "Explain only what the problem is asking. Include the goal, key rules, one small example, and the subtle point students often miss. Do not give the algorithm or code.",
  debug: "Review the student's actual code. Identify the exact bug, explain why it fails on one concrete case, and show the corrected version in a fenced code block only if needed.",
  complexity: "State the current time and space complexity precisely using LaTeX, then say whether a better approach exists and what its complexity would be.",
  dry_run: "Give a step-by-step dry run in table-like plain text.",
  full_solution: "Provide the optimal solution with short intuition, one clean code block, and explicit LaTeX complexity.",
  optimize: "Compare the current approach with a better one. State old and new complexities in LaTeX and explain the upgrade path without fluff."
};

interface GroqChatCompletionsResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class AIService {
  async generateAssistantResponse(request: AssistantRequest): Promise<AssistantResponse> {
    if (request.mode === "hint") {
      const localHint = this.generateProgressiveHint(request);
      if (localHint) {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
          return {
            answer: localHint,
            suggestedNextStep: "Ask for the next hint level only if you still feel stuck."
          };
        }
      }
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return {
        answer:
          "The Groq API key is missing on the server. Add `GROQ_API_KEY` in `apps/server/.env` to enable mentor responses.",
        suggestedNextStep: "Create a Groq API key, add it to the server env file, and try again."
      };
    }

    const model = process.env.AI_MODEL ?? DEFAULT_MODEL;
    const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: assistantSystemPrompt },
          { role: "user", content: this.buildUserPrompt(request) }
        ],
        temperature: request.mode === "hint" ? 0.25 : 0.5,
        top_p: request.mode === "hint" ? 0.9 : 0.95,
        max_tokens: request.mode === "hint" ? 420 : 1800
      }),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Groq request failed with status ${response.status}.`);
    }

    let data: GroqChatCompletionsResponse;
    try {
      data = (await response.json()) as GroqChatCompletionsResponse;
    } catch {
      throw new Error("Groq returned an invalid JSON response.");
    }
    let answer = data.choices?.[0]?.message?.content ?? "";
    if (Array.isArray(answer)) {
      answer = answer.map((part) => part.text ?? "").join("");
    }
    answer = answer.trim();

    if (!answer) {
      if (data.error?.message) {
        throw new Error(`Groq request failed: ${data.error.message}`);
      }
      throw new Error("Groq returned an empty response.");
    }

    if (request.mode === "hint" && (!this.isHintShapeValid(answer, request.hintLevel ?? 1) || answer.includes("```") || answer.length < 40)) {
      const localHint = this.generateProgressiveHint(request);
      if (localHint) {
        return {
          answer: localHint,
          suggestedNextStep: "Ask for the next hint level only if you still feel stuck."
        };
      }
    }

    return {
      answer,
      suggestedNextStep: this.suggestNextStep(request.mode)
    };
  }

  private buildUserPrompt(request: AssistantRequest): string {
    const limitedExamples = request.mode === "hint" ? request.problem?.examples.slice(0, 1) ?? [] : request.problem?.examples ?? [];
    const hintLevel = request.hintLevel ?? 1;
    return [
      `Mode: ${request.mode}`,
      `Mode guidance: ${modeGuidance[request.mode]}`,
      `Required response shape:\n${this.responseContract(request.mode, hintLevel)}`,
      request.hintLevel ? `Hint level: ${request.hintLevel}` : "",
      request.language ? `Preferred language: ${request.language}` : "Preferred language: C++",
      request.userQuestion ? `Student question: ${request.userQuestion}` : "",
      request.mode === "hint"
        ? [
            "Hint safety checklist:",
            "- Match the exact title, statement, examples, and constraints below.",
            "- Verify the approach against the first example before answering.",
            "- Do not solve a different LeetCode question with a similar title.",
            "- Prefer a safe next coding move over a broad theory explanation."
          ].join("\n")
        : "",
      request.problem
        ? `Problem context:
Title: ${request.problem.title}
Frontend ID: ${request.problem.questionFrontendId}
Difficulty: ${request.problem.difficulty}
Tags: ${request.problem.tags.join(", ")}
Statement: ${request.problem.statement}
Examples: ${limitedExamples.join("\n")}
Constraints: ${request.problem.constraints.join("\n")}`
        : "Problem context is missing. Ask the student to paste the problem statement instead of inventing it.",
      request.userCode ? `Student code:\n${request.userCode}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private responseContract(mode: AssistantRequest["mode"], hintLevel = 1): string {
    switch (mode) {
      case "hint":
        return this.hintResponseContract(hintLevel);
      case "explain":
        return ["Use this exact section order:", "### Goal", "### Rules", "### Small example", "### What makes it tricky", "Do not give the algorithm.", "Do not include code."].join("\n");
      case "debug":
        return ["Use this exact section order when relevant:", "### Issue", "### Why it breaks", "### Fix", "### Corrected code"].join("\n");
      case "complexity":
        return ["Use this exact section order:", "### Complexity", "### Better approach", "Write every complexity in LaTeX."].join("\n");
      case "optimize":
        return ["Use this exact section order:", "### Current bottleneck", "### Better approach", "### Complexity change"].join("\n");
      case "full_solution":
        return ["Use this exact section order:", "### Idea", "### Code", "### Complexity", "Return exactly one fenced code block."].join("\n");
      case "dry_run":
        return ["Use this exact section order:", "### Example", "### Dry run"].join("\n");
      default:
        return ["Use short sections.", "Use LaTeX for formulas or complexity.", "Use fenced code blocks for code."].join("\n");
    }
  }

  private suggestNextStep(mode: AssistantRequest["mode"]): string {
    switch (mode) {
      case "hint":
        return "Code the hinted next step first; ask for the next hint only if that checkpoint still blocks you.";
      case "debug":
        return "Run the corrected logic on one more edge case.";
      case "complexity":
        return "Compare the brute force and optimized approaches on a small input.";
      default:
        return "Ask for a dry run, hint, or code review if you want to go deeper.";
    }
  }

  private hintResponseContract(hintLevel: number): string {
    if (hintLevel === 1) {
      return [
        "Use this exact section order:",
        "### Starting hint",
        "Write 2 short sentences: first, what to notice in this exact problem; second, why that observation points to the next move.",
        "### Try this next",
        "Write 1 concrete action the student can code or decide now. It must be specific to the problem, not generic advice.",
        "### Self-check",
        "Write 1 short question the student can ask to know whether the direction is correct.",
        "### Starter cue",
        "Write exactly 1 short line in backticks with a formula, expression, loop condition, variable name, or invariant.",
        "Do not include `std::`, imports, library names, class wrappers, semicolons, or full type declarations in the starter cue.",
        "Do not include full code."
      ].join("\n");
    }

    if (hintLevel === 2) {
      return [
        "Use this exact section order:",
        "### Directional hint",
        "Write 2 to 3 short sentences naming the likely pattern and why it fits the given constraints/examples.",
        "### Coding plan",
        "Write exactly 3 numbered steps, using `1.`, `2.`, and `3.`.",
        "Each step must be one short action the student can code next, not a paragraph.",
        "Keep each step under 18 words and do not include full code.",
        "### Checkpoint",
        "Write 1 short sentence about the condition, update order, invariant, or edge case the student should verify.",
        "Do not include code."
      ].join("\n");
    }

    return [
      "Use this exact section order:",
      "### Algorithm hint",
      "### Core idea",
      "Write 1 or 2 short sentences about the state, structure, or pattern that solves this exact problem and why.",
      "### Steps",
      "Write exactly 4 numbered, problem-specific steps describing the solving algorithm.",
      "### Edge check",
      "Write 1 edge case or sample condition the student should test after coding.",
      "Do not include code."
    ].join("\n");
  }

  private isHintShapeValid(answer: string, hintLevel: number): boolean {
    const normalized = answer.toLowerCase();
    if (hintLevel === 1) {
      return (
        normalized.includes("### starting hint") &&
        normalized.includes("### try this next") &&
        normalized.includes("### self-check") &&
        normalized.includes("### starter cue") &&
        answer.includes("`") &&
        !this.hasBadStarterCue(answer)
      );
    }
    if (hintLevel === 2) {
      return (
        normalized.includes("### directional hint") &&
        normalized.includes("### coding plan") &&
        normalized.includes("### checkpoint")
      );
    }
    return (
      normalized.includes("### algorithm hint") &&
      normalized.includes("### core idea") &&
      normalized.includes("### steps") &&
      normalized.includes("### edge check") &&
      (answer.match(/^\d+\.\s/gm) ?? []).length === 4
    );
  }

  private hasBadStarterCue(answer: string): boolean {
    const match = answer.match(/### starter cue\s+`([^`]+)`/i);
    if (!match) {
      return true;
    }

    const cue = match[1].trim();
    if (cue.length > 90) {
      return true;
    }

    return /(std\s*::|#include|using\s+namespace|class\s+solution|\b(?:vector|map|unordered_map|unordered_set|set|queue|stack|priority_queue)\s*<|\b(?:int|long|double|bool|string|auto|char)\s+\w+\s*[;=({])/i.test(cue);
  }

  private generateProgressiveHint(request: AssistantRequest): string | null {
    const problem = request.problem;
    if (!problem) {
      return null;
    }

    const hintLevel = request.hintLevel ?? 1;

    const levelOne = (notice: string, tryNext: string, selfCheck: string, cue: string): string =>
      [
        "### Starting hint",
        notice,
        "",
        "### Try this next",
        tryNext,
        "",
        "### Self-check",
        selfCheck,
        "",
        "### Starter cue",
        `\`${cue}\``
      ].join("\n");

    const levelTwo = (direction: string, plan: string[], checkpoint: string): string =>
      [
        "### Directional hint",
        direction,
        "",
        "### Coding plan",
        ...plan.slice(0, 3).map((step, index) => `${index + 1}. ${step}`),
        "",
        "### Checkpoint",
        checkpoint
      ].join("\n");

    const levelThree = (coreIdea: string, steps: string[], edgeCheck: string): string =>
      [
        "### Algorithm hint",
        "### Core idea",
        coreIdea,
        "",
        "### Steps",
        ...steps.slice(0, 4).map((step, index) => `${index + 1}. ${step}`),
        "",
        "### Edge check",
        edgeCheck
      ].join("\n");

    const problemName = problem.title.trim() || "this problem";
    return hintLevel === 1
      ? levelOne(
          `Start with the exact goal of ${problemName} and the first provided example. Identify one rule from the statement that changes what a valid next step can be.`,
          "Trace one step of the first example and write down only the information needed to decide the following step.",
          "Does the information you kept distinguish a valid next move from an invalid one?",
          "state_needed_for_the_next_decision"
        )
      : hintLevel === 2
        ? levelTwo(
            `Build the direction from ${problemName}'s statement, examples, and constraints rather than assuming an algorithm from its tags. Focus on the decision that repeats as the input is processed.`,
            [
              "Write the required output for the first example in your own words.",
              "Name the smallest information needed to make one repeated decision.",
              "Choose a processing order that keeps that information available."
            ],
            "After each step, can you explain exactly what your saved state means?"
          )
        : levelThree(
            `Work backward from ${problemName}'s required output and define the minimum state needed for each decision. Avoid selecting a pattern from tags alone; verify every step against the examples and constraints.`,
            [
              "State the required output and the condition that makes an answer valid.",
              "Identify the repeated decision and the information it needs.",
              "Process the input in an order that makes earlier work reusable.",
              "Verify the resulting steps against the first example and smallest edge case."
            ],
            "Test the smallest valid input and an input where the first obvious choice is not sufficient."
          );
  }
}
