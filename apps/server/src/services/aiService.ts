import type { AssistantRequest, AssistantResponse } from "@leetcode-assistant/shared";
import { assistantSystemPrompt } from "../prompts/systemPrompt.js";

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

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

    const tags = problem.tags.map((tag) => tag.toLowerCase());
    const hintLevel = request.hintLevel ?? 1;
    const statement = `${problem.title} ${problem.statement}`.toLowerCase();

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

    if (tags.includes("hash table")) {
      if (hintLevel === 1) {
        return levelOne(
          "Notice whether each current value needs a matching earlier value to finish the answer. That points to remembering what you have already seen instead of scanning again.",
          "Write the expression for the value you wish you had seen before the current element.",
          "Can you decide the answer for `nums[i]` using only earlier elements?",
          "need = target - nums[i]"
        );
      }
      if (hintLevel === 2) {
        return levelTwo(
          "A lookup table fits because the question repeatedly asks whether a needed value already exists. The important detail is update order.",
          [
            "Create a map from value to the index where it appeared.",
            "For each current value, compute the partner needed for a valid answer.",
            "Check the map before adding the current value so you do not reuse the same element."
          ],
          "If the current value appears twice, does your code still avoid using the same index twice?"
        );
      }
      return levelThree(
        "Use one pass plus a lookup table so each number can immediately check whether its partner has already appeared.",
        [
          "Create a lookup table for values you have already seen.",
          "Scan the input from left to right and compute the partner needed for the current value.",
          "If that partner is already in the lookup table, use the stored position and the current position to form the answer.",
          "Otherwise, store the current value with its position and continue."
        ],
        "Test a case with duplicate values so you know the lookup order is correct."
      );
    }

    if ((tags.includes("math") || tags.includes("simulation")) && statement.includes("clock") && statement.includes("angle")) {
      if (hintLevel === 1) {
        return levelOne(
          "Notice that both clock hands can be converted into angles from 12 o'clock. The hour hand also moves while minutes pass, so it is not just `30 * hour`.",
          "Compute the minute angle and hour angle separately before comparing them.",
          "Does your hour angle change when `minutes` changes?",
          "minuteAngle = 6 * minutes; hourAngle = 30 * (hour % 12) + 0.5 * minutes"
        );
      }
      if (hintLevel === 2) {
        return levelTwo(
          "This is a formula problem: compute both hand angles, then handle the circular distance. The final comparison is between the direct gap and the wraparound gap.",
          [
            "Convert minutes to degrees using 6 degrees per minute.",
            "Convert hours to degrees and add the extra minute movement.",
            "Take the smaller of `diff` and `360 - diff`."
          ],
          "Treat `12` like `0` on the clock face."
        );
      }
      return levelThree(
        "Turn the problem into two angle computations, then take the smaller circular distance between them.",
        [
          "Convert the minute value into the minute-hand angle.",
          "Convert the hour and minute values into the hour-hand angle, including minute movement.",
          "Compute the absolute difference between the two angles.",
          "Return the smaller value between that difference and the full-circle complement."
        ],
        "Test `12:00`, because both hands should produce angle `0`."
      );
    }

    if (tags.includes("two pointers")) {
      if (hintLevel === 1) {
        return levelOne(
          "Notice whether the problem lets one comparison eliminate a group of impossible answers. That is the main reason two pointers may help.",
          "Define what `left` and `right` represent before deciding how either pointer moves.",
          "After one pointer move, which answers did you safely rule out?",
          "while left < right:"
        );
      }
      if (hintLevel === 2) {
        return levelTwo(
          "Two pointers fit when the current pair/window gives enough information to discard one side. The move rule must come from the problem's ordering, sum, window, or validity condition.",
          [
            "Initialize the pointers at the positions the pattern requires.",
            "Evaluate the condition formed by the current pointer positions.",
            "Move the pointer that discards impossible answers while preserving possible ones."
          ],
          "Every pointer move should have a reason; if it does not, the approach may be wrong."
        );
      }
      return levelThree(
        "Use two moving positions so each comparison removes unnecessary work instead of restarting a scan.",
        [
          "Initialize the two pointers at the positions the pattern requires.",
          "Compare the current state formed by those pointers.",
          "Move exactly one pointer according to the condition that discards impossible answers.",
          "Stop when the pointers meet the condition that reveals the final answer."
        ],
        "Test a case where the best answer is near the start or end, not only in the middle."
      );
    }

    if (tags.includes("binary search")) {
      if (hintLevel === 1) {
        return levelOne(
          "Notice whether the problem has a sorted range, monotonic condition, or answer space where once something becomes true it stays true. That is the real reason binary search may apply.",
          "Write down what `left` and `right` mean in this problem, then write the middle candidate.",
          "If you test `mid`, can you prove which side can be discarded?",
          "mid = left + (right - left) // 2"
        );
      }
      if (hintLevel === 2) {
        return levelTwo(
          "Binary search fits only if your check on `mid` is monotonic. The goal is to turn the problem into a yes/no test that safely eliminates half.",
          [
            "Define the meaning of the search bounds in words.",
            "Write the condition that tests whether `mid` is too small, too large, or valid.",
            "Update exactly one bound in each branch so the interval shrinks."
          ],
          "Can your loop get stuck when only two candidates remain?"
        );
      }
      return levelThree(
        "Binary search works when one test on the middle candidate tells you which half of the remaining search space is still valid.",
        [
          "Set the low and high boundaries of the valid search space.",
          "Compute the middle candidate each round.",
          "Evaluate the middle candidate and discard the invalid half.",
          "Stop when the bounds converge or the exact target is found, depending on the problem goal."
        ],
        "Test the smallest input and a case where the answer is at the boundary."
      );
    }

    if (tags.includes("dynamic programming")) {
      if (hintLevel === 1) {
        return levelOne(
          "Notice whether the same smaller decisions repeat across the problem. DP starts by naming exactly what one saved answer means.",
          "Before transitions, write a sentence for `dp[i]` or `dp[i][j]` in terms of the input.",
          "Can you explain one DP cell without saying 'the answer so far' vaguely?",
          "dp[i] = best answer using the first i positions/items"
        );
      }
      if (hintLevel === 2) {
        return levelTwo(
          "DP fits when the answer for a larger prefix/state can be built from earlier states. The hard part is choosing a state that contains enough information but not too much.",
          [
            "Define the DP state in one precise sentence.",
            "List the previous states that can transition into the current state.",
            "Choose a fill order where those previous states are already computed."
          ],
          "If two different histories lead to the same DP state, do they need the same future information?"
        );
      }
      return levelThree(
        "Store answers for smaller states and reuse them so repeated subproblems are solved once.",
        [
          "Define the DP state so each entry has one clear meaning.",
          "Set the base cases from the smallest valid inputs.",
          "Write the transition using only states that are already known.",
          "Return the state that represents the complete input."
        ],
        "Test the smallest input because DP bugs usually start in base cases."
      );
    }

    return hintLevel === 1
      ? levelOne(
          "Identify the first quantity, state, or condition you can compute directly from the input. Then ask what information you wish you already knew before making the next decision.",
          "Write down the repeated decision in the problem, then name the state that would make that decision easier.",
          "After one element or step, what changes and what must stay remembered?",
          "track_the_state_you_need_before_the_next_step"
        )
      : hintLevel === 2
        ? levelTwo(
            "Focus on the repeated decision in the problem and decide what must be tracked before moving forward. Once that tracked state is clear, the flow usually becomes one pass, ordered traversal, search, or DP.",
            [
              "State the repeated decision in plain English.",
              "Choose the smallest state or helper structure that answers that decision.",
              "Process the input in the order that keeps the state useful."
            ],
            "You should be able to explain what changes after every step and why that helps the next step."
          )
        : levelThree(
            "Identify the minimum state or helper structure that removes repeated work, then process the input in the order that keeps that state useful.",
            [
              "Identify the exact state or helper structure you need to maintain.",
              "Process the input in the order that makes earlier work reusable.",
              "Update that state after each step according to the current element or condition.",
              "Return the final value once the traversal, search, or construction is complete."
            ],
            "Test the smallest valid input and one case where the obvious greedy choice might fail."
          );
  }
}
