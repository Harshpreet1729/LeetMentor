import type { AssistantRequest, AssistantResponse } from "@leetcode-assistant/shared";
import { assistantSystemPrompt } from "../prompts/systemPrompt.js";

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

const modeGuidance: Record<AssistantRequest["mode"], string> = {
  hint: "Give a progressive directional hint only. Respect hint level if it is provided. Return exactly 2 short lines in this format: `Direction: ...` and `Think next: ...`. Stay under 60 words. Do not use code.",
  explain: "Explain the problem briefly. Include the goal, one small example, and the core idea. Use LaTeX if a formula appears.",
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
    if (request.mode === "hint" && (request.hintLevel ?? 1) === 1) {
      const localHint = this.generateDirectionalHint(request);
      if (localHint) {
        return {
          answer: localHint,
          suggestedNextStep: "Ask for the next hint level only if you still feel stuck."
        };
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
        temperature: request.mode === "hint" ? 0.35 : 0.5,
        top_p: 0.95,
        max_tokens: request.mode === "hint" ? 180 : 1800
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq request failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as GroqChatCompletionsResponse;
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

    if (request.mode === "hint" && (!answer.includes("Think next:") || answer.length < 35)) {
      const localHint = this.generateDirectionalHint(request);
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
    return [
      `Mode: ${request.mode}`,
      `Mode guidance: ${modeGuidance[request.mode]}`,
      `Required response shape:\n${this.responseContract(request.mode)}`,
      request.hintLevel ? `Hint level: ${request.hintLevel}` : "",
      request.language ? `Preferred language: ${request.language}` : "Preferred language: C++",
      request.userQuestion ? `Student question: ${request.userQuestion}` : "",
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

  private responseContract(mode: AssistantRequest["mode"]): string {
    switch (mode) {
      case "hint":
        return ["Return exactly 2 lines.", "Line 1: Direction: ...", "Line 2: Think next: ..."].join("\n");
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
        return "Ask for the next hint level only if you still feel stuck.";
      case "debug":
        return "Run the corrected logic on one more edge case.";
      case "complexity":
        return "Compare the brute force and optimized approaches on a small input.";
      default:
        return "Ask for a dry run, hint, or code review if you want to go deeper.";
    }
  }

  private generateDirectionalHint(request: AssistantRequest): string | null {
    const problem = request.problem;
    if (!problem) {
      return null;
    }

    const tags = problem.tags.map((tag) => tag.toLowerCase());

    if (tags.includes("hash table")) {
      return [
        "Direction: Think about fast lookup instead of checking every pair.",
        "Think next: For each value, ask what partner value is needed and how to know if you have already seen it."
      ].join("\n");
    }

    if (tags.includes("two pointers") && tags.includes("linked list")) {
      return [
        "Direction: Use moving pointers instead of converting the linked list into another structure.",
        "Think next: Ask how one pointer can help find the middle while another keeps track of the node before it."
      ].join("\n");
    }

    if (tags.includes("two pointers")) {
      return [
        "Direction: Try solving it by moving two positions through the data instead of restarting scans.",
        "Think next: Ask when each pointer should move and what condition tells you the answer is found."
      ].join("\n");
    }

    if (tags.includes("binary search")) {
      return [
        "Direction: Focus on the answer range, not just the raw array values.",
        "Think next: Ask what yes/no condition lets you discard half the search space each step."
      ].join("\n");
    }

    if (tags.includes("dynamic programming")) {
      return [
        "Direction: Think about how a small solved state can help build a larger one.",
        "Think next: Ask what one state should store and how it transitions from earlier states."
      ].join("\n");
    }

    if (tags.includes("breadth-first search") || tags.includes("depth-first search") || tags.includes("graph")) {
      return [
        "Direction: Treat the problem like exploring connected states instead of isolated values.",
        "Think next: Ask what each node or state is, and how to mark visited work so you do not repeat it."
      ].join("\n");
    }

    if (tags.includes("heap (priority queue)")) {
      return [
        "Direction: Keep track of the most useful candidate at each step instead of sorting everything again.",
        "Think next: Ask what item should stay on top, and what information must be pushed back after each update."
      ].join("\n");
    }

    return [
      "Direction: Focus on the key observation that reduces brute force work.",
      "Think next: Ask what information you wish you could know instantly while scanning the input once."
    ].join("\n");
  }
}
