import type { AssistantRequest, AssistantResponse } from "@leetcode-assistant/shared";
import { assistantSystemPrompt } from "../prompts/systemPrompt.js";

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

const modeGuidance: Record<AssistantRequest["mode"], string> = {
  hint: "Give a progressive hint only. Respect hint level exactly. Make the hint actionable enough for the student to begin writing. Level 1 must include one tiny starter cue line in backticks. Level 3 must describe the solving algorithm, not a dry run. Do not use full code.",
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
        return "Ask for the next hint level only if you still feel stuck.";
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
        "Write 1 or 2 short sentences about the best first move.",
        "### Starter cue",
        "Write exactly 1 short line in backticks with a formula, expression, or variable setup.",
        "Do not include full code."
      ].join("\n");
    }

    if (hintLevel === 2) {
      return [
        "Use this exact section order:",
        "### Directional hint",
        "Write 2 to 4 short sentences about the flow of the approach.",
        "### Checkpoint",
        "Write 1 short sentence about the condition, update order, or invariant to verify next.",
        "Do not include code."
      ].join("\n");
    }

    return [
      "Use this exact section order:",
      "### Algorithm hint",
      "### Core idea",
      "Write 1 or 2 short sentences about the state, structure, or pattern.",
      "### Steps",
      "Write exactly 4 numbered, problem-specific steps describing the solving algorithm.",
      "Do not include code."
    ].join("\n");
  }

  private isHintShapeValid(answer: string, hintLevel: number): boolean {
    const normalized = answer.toLowerCase();
    if (hintLevel === 1) {
      return normalized.includes("### starting hint") && normalized.includes("### starter cue") && answer.includes("`");
    }
    if (hintLevel === 2) {
      return normalized.includes("### directional hint") && normalized.includes("### checkpoint");
    }
    return (
      normalized.includes("### algorithm hint") &&
      normalized.includes("### core idea") &&
      normalized.includes("### steps") &&
      (answer.match(/^\d+\.\s/gm) ?? []).length === 4
    );
  }

  private generateProgressiveHint(request: AssistantRequest): string | null {
    const problem = request.problem;
    if (!problem) {
      return null;
    }

    const tags = problem.tags.map((tag) => tag.toLowerCase());
    const hintLevel = request.hintLevel ?? 1;
    const statement = `${problem.title} ${problem.statement}`.toLowerCase();

    if (tags.includes("hash table")) {
      if (hintLevel === 1) {
        return ["### Starting hint", "Do one left-to-right pass and ask what partner value would finish the answer for the current value.", "", "### Starter cue", "`need = target - nums[i]`"].join("\n");
      }
      if (hintLevel === 2) {
        return ["### Directional hint", "Keep a lookup of earlier values so each new value can check its partner instantly.", "", "### Checkpoint", "Query the lookup before inserting the current value."].join("\n");
      }
      return [
        "### Algorithm hint",
        "### Core idea",
        "Use one pass plus a lookup table so each value can ask whether its partner has already appeared.",
        "",
        "### Steps",
        "1. Create a lookup table for values already seen.",
        "2. Scan the input and compute the partner needed for the current value.",
        "3. If that partner exists in the lookup table, form the answer from the stored position and current position.",
        "4. Otherwise store the current value and continue."
      ].join("\n");
    }

    if ((tags.includes("math") || tags.includes("simulation")) && statement.includes("clock") && statement.includes("angle")) {
      if (hintLevel === 1) {
        return [
          "### Starting hint",
          "Turn the clock into two separate angle formulas before comparing anything.",
          "The hour hand is the subtle part because it moves continuously while the minutes pass.",
          "",
          "### Starter cue",
          "`minuteAngle = 6 * minutes`, `hourAngle = 30 * (hour % 12) + 0.5 * minutes`"
        ].join("\n");
      }
      if (hintLevel === 2) {
        return [
          "### Directional hint",
          "Compute the two angles separately, then take their absolute difference.",
          "Because the clock is circular, compare that difference with the wraparound gap as well.",
          "",
          "### Checkpoint",
          "Treat `12` like `0` on the clock face."
        ].join("\n");
      }
      return [
        "### Algorithm hint",
        "### Core idea",
        "Compute each hand's angle directly, then return the smaller circular distance between them.",
        "",
        "### Steps",
        "1. Convert the minute value into the minute-hand angle.",
        "2. Convert the hour and minute values into the hour-hand angle, including the extra movement from the minutes.",
        "3. Compute the absolute difference between the two angles.",
        "4. Return the smaller value between that difference and the full-circle complement."
      ].join("\n");
    }

    if (tags.includes("two pointers")) {
      if (hintLevel === 1) {
        return ["### Starting hint", "Think about what each pointer should represent before you move either one.", "", "### Starter cue", "`while left < right:`"].join("\n");
      }
      if (hintLevel === 2) {
        return ["### Directional hint", "Decide what makes the left pointer move and what makes the right pointer move, then keep that rule consistent.", "", "### Checkpoint", "Every pointer move should eliminate one set of impossible answers."].join("\n");
      }
      return [
        "### Algorithm hint",
        "### Core idea",
        "Use two moving positions so each comparison removes unnecessary work instead of restarting a scan.",
        "",
        "### Steps",
        "1. Initialize the two pointers at the positions the pattern requires.",
        "2. Compare the current state formed by those pointers.",
        "3. Move exactly one pointer according to the condition that discards impossible answers.",
        "4. Stop when the pointers meet the condition that reveals the final answer."
      ].join("\n");
    }

    if (tags.includes("binary search")) {
      if (hintLevel === 1) {
        return ["### Starting hint", "Decide whether you are searching an index range or an answer range, then write the middle candidate formula.", "", "### Starter cue", "`mid = left + (right - left) // 2`"].join("\n");
      }
      if (hintLevel === 2) {
        return ["### Directional hint", "The real decision is not the mid formula; it is the yes-or-no condition that tells you which half to discard.", "", "### Checkpoint", "Make sure every branch shrinks the search space."].join("\n");
      }
      return [
        "### Algorithm hint",
        "### Core idea",
        "One test on the middle candidate should tell you which half of the remaining search space is still valid.",
        "",
        "### Steps",
        "1. Set the low and high boundaries of the valid search space.",
        "2. Repeatedly compute the middle candidate.",
        "3. Evaluate the middle candidate and discard the invalid half of the search space.",
        "4. Continue until the stopping condition gives the final answer."
      ].join("\n");
    }

    if (tags.includes("dynamic programming")) {
      if (hintLevel === 1) {
        return ["### Starting hint", "Name one smaller subproblem whose answer helps build the full answer before you think about transitions.", "", "### Starter cue", "`dp[i] = best answer for the first i states/items`"].join("\n");
      }
      if (hintLevel === 2) {
        return ["### Directional hint", "Write the state first, then decide which earlier states are allowed to transition into it.", "", "### Checkpoint", "If you cannot explain the meaning of one DP cell in one sentence, the state is still too vague."].join("\n");
      }
      return [
        "### Algorithm hint",
        "### Core idea",
        "Store answers for smaller states and reuse them instead of recomputing the same work.",
        "",
        "### Steps",
        "1. Define the DP state so each entry has one clear meaning.",
        "2. Write the transition using only earlier states that are already known.",
        "3. Fill the states in dependency order.",
        "4. Return the state that represents the full problem answer."
      ].join("\n");
    }

    return hintLevel === 1
      ? ["### Starting hint", "Identify the first quantity, state, or condition you can compute directly from the input.", "", "### Starter cue", "`track_the_state_you_need_before_the_next_step`"].join("\n")
      : hintLevel === 2
        ? ["### Directional hint", "Focus on the repeated decision in the problem and decide what must be tracked so the next step becomes easier.", "", "### Checkpoint", "You should be able to explain what changes after each step and why."].join("\n")
        : [
            "### Algorithm hint",
            "### Core idea",
            "Find the minimum state or helper structure that removes repeated work, then process the input in the order that keeps that state useful.",
            "",
            "### Steps",
            "1. Identify the exact state or helper structure you need to maintain.",
            "2. Process the input in the order that makes earlier work reusable.",
            "3. Update that state after each step according to the current element or condition.",
            "4. Return the final value once the traversal or construction is complete."
          ].join("\n");
  }
}
