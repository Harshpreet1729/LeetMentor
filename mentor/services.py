"""Validate mentor requests, call Groq, and provide limited offline guidance."""

import os
import re
from typing import Any

import requests

from .prompts import ASSISTANT_SYSTEM_PROMPT, MODE_GUIDANCE


DEFAULT_MODEL = "llama-3.3-70b-versatile"
MODEL_FALLBACKS = (
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "llama-3.1-8b-instant",
)
GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions"


class AIService:
    """Keep provider requests and response checks separate from Django views."""

    def generate_assistant_response(self, payload: dict[str, Any]) -> dict[str, Any]:
        self._validate_payload(payload)
        mode = payload["mode"]

        # Only hints, explanations, and basic review checks work without Groq.
        local_fallback = self._fallback_for_mode(payload)

        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            if local_fallback:
                return {
                    "answer": local_fallback,
                    "suggestedNextStep": self._suggest_next_step(mode)
                }
            raise ValueError("Missing GROQ_API_KEY. Add it to your root .env file.")

        try:
            answer = self._request_groq(payload, api_key)
        except ValueError:
            if local_fallback:
                return {
                    "answer": local_fallback,
                    "suggestedNextStep": self._suggest_next_step(mode)
                }
            raise

        if mode == "hint":
            hint_level = int(payload.get("hintLevel") or 1)
            local_hint = self._generate_progressive_hint(payload.get("problem"), hint_level)
            if local_hint and (len(answer) < 40 or not self._hint_shape_is_valid(answer, hint_level) or "```" in answer):
                answer = local_hint

        if mode == "explain":
            local_explanation = self._generate_concise_explanation(payload.get("problem"))
            if local_explanation and (
                len(answer) < 40
                or not self._explanation_shape_is_valid(answer)
                or "```" in answer
                or "### Code" in answer
                or "Algorithm hint" in answer
            ):
                answer = local_explanation

        return {"answer": answer, "suggestedNextStep": self._suggest_next_step(mode)}

    def _validate_payload(self, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ValueError("Request body must be an object.")

        mode = payload.get("mode")
        if mode not in MODE_GUIDANCE:
            raise ValueError("Unsupported mentor mode.")

        language = payload.get("language", "C++")
        if language not in {"C++", "Python", "Java", "JavaScript"}:
            raise ValueError("Unsupported programming language.")

        hint_level = payload.get("hintLevel", 1)
        if isinstance(hint_level, bool) or not isinstance(hint_level, int) or hint_level not in {1, 2, 3}:
            raise ValueError("Hint level must be 1, 2, or 3.")

        for field, maximum in (("userQuestion", 4_000), ("userCode", 60_000)):
            value = payload.get(field, "")
            if value is not None and not isinstance(value, str):
                raise ValueError(f"{field} must be text.")
            if isinstance(value, str) and len(value) > maximum:
                raise ValueError(f"{field} is too long.")

        problem = payload.get("problem")
        if problem is not None and not isinstance(problem, dict):
            raise ValueError("Problem context must be an object.")
        if isinstance(problem, dict):
            statement = problem.get("statement", "")
            if not isinstance(statement, str) or len(statement) > 80_000:
                raise ValueError("Problem statement is invalid or too long.")
            for field, limit in (("examples", 12), ("constraints", 80), ("tags", 40)):
                values = problem.get(field, [])
                if not isinstance(values, list) or len(values) > limit or any(not isinstance(item, str) for item in values):
                    raise ValueError(f"Problem {field} are invalid or too large.")

    def _hint_shape_is_valid(self, answer: str, hint_level: int) -> bool:
        normalized = answer.lower()
        if hint_level == 1:
            return (
                "### starting hint" in normalized
                and "### try this next" in normalized
                and "### self-check" in normalized
                and "### starter cue" in normalized
                and "`" in answer
                and not self._has_bad_starter_cue(answer)
            )
        if hint_level == 2:
            return (
                "### directional hint" in normalized
                and "### coding plan" in normalized
                and "### checkpoint" in normalized
            )
        return (
            "### algorithm hint" in normalized
            and "### core idea" in normalized
            and "### steps" in normalized
            and "### edge check" in normalized
            and len(re.findall(r"^\d+\.\s", answer, flags=re.MULTILINE)) == 4
        )

    def _has_bad_starter_cue(self, answer: str) -> bool:
        match = re.search(r"### starter cue\s+`([^`]+)`", answer, flags=re.IGNORECASE)
        if not match:
            return True

        cue = match.group(1).strip()
        if len(cue) > 90:
            return True

        return bool(
            re.search(
                r"(std\s*::|#include|using\s+namespace|class\s+solution|\b(?:vector|map|unordered_map|unordered_set|set|queue|stack|priority_queue)\s*<|\b(?:int|long|double|bool|string|auto|char)\s+\w+\s*[;=({])",
                cue,
                flags=re.IGNORECASE,
            )
        )

    def _explanation_shape_is_valid(self, answer: str) -> bool:
        normalized = answer.lower()
        required_sections = (
            "### goal",
            "### rules",
            "### small example",
            "### what makes it tricky",
        )
        return all(section in normalized for section in required_sections)

    def _request_groq(self, payload: dict[str, Any], api_key: str) -> str:
        mode = payload["mode"]
        user_prompt = self._build_user_prompt(payload)
        body = {
            "messages": [
                {"role": "system", "content": ASSISTANT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.25 if mode in {"hint", "explain", "complexity"} else 0.4,
            "top_p": 0.9,
            "max_tokens": self._max_tokens_for_mode(mode),
        }

        last_error: ValueError | None = None
        for model in self._candidate_models():
            request_body = {
                **body,
                "model": model,
            }
            try:
                response = requests.post(
                    GROQ_CHAT_COMPLETIONS_URL,
                    headers={
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}",
                        "User-Agent": (
                            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                            "AppleWebKit/537.36 (KHTML, like Gecko) "
                            "Chrome/125.0.0.0 Safari/537.36"
                        ),
                    },
                    json=request_body,
                    timeout=22,
                )
                if response.status_code >= 400:
                    details = response.text
                    if self._should_retry_model(response.status_code, details):
                        last_error = ValueError(f"Groq model `{model}` is unavailable.")
                        continue
                    raise ValueError(self._format_groq_http_error(response.status_code, details))
                data = response.json()
                answer = self._extract_groq_answer(data)
                if answer:
                    return answer
                last_error = ValueError("Groq returned an empty response.")
            except requests.RequestException as error:
                raise ValueError("Could not reach Groq. Check your internet connection and try again.") from error

        raise last_error or ValueError("No working Groq model was available.")

    def _candidate_models(self) -> list[str]:
        configured = (os.environ.get("AI_MODEL") or DEFAULT_MODEL).strip()
        ordered = [configured, DEFAULT_MODEL, *MODEL_FALLBACKS]
        seen: set[str] = set()
        models: list[str] = []
        for model in ordered:
            normalized = model.strip()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            models.append(normalized)
        return models

    def _format_groq_http_error(self, status_code: int, details: str) -> str:
        normalized = (details or "").lower()
        if status_code == 403 and "1010" in normalized:
            return (
                "Groq blocked this app request at the network edge (403 / 1010). "
                "The API key works, but this request shape or network path was rejected. "
                "Please retry after restarting the app. If it continues, the app request path needs adjustment."
            )
        return f"Groq request failed: {status_code} {details}".strip()

    def _should_retry_model(self, status_code: int, details: str) -> bool:
        if status_code not in {400, 404}:
            return False
        normalized = details.lower()
        return any(
            phrase in normalized
            for phrase in (
                "model",
                "not found",
                "does not exist",
                "unsupported",
                "not supported",
                "decommissioned",
            )
        )

    def _extract_groq_answer(self, data: dict[str, Any]) -> str:
        choices = data.get("choices") or []
        message = choices[0].get("message", {}) if choices else {}
        answer = message.get("content", "")
        if isinstance(answer, list):
            answer = "".join(part.get("text", "") for part in answer if isinstance(part, dict))
        answer = str(answer).strip()
        if answer:
            return answer

        error = data.get("error") or {}
        if isinstance(error, dict) and error.get("message"):
            raise ValueError(str(error["message"]))
        return ""

    def _build_user_prompt(self, payload: dict[str, Any]) -> str:
        problem = payload.get("problem") or {}
        mode = payload["mode"]
        examples = (problem.get("examples") or [])[:1] if mode == "hint" else (problem.get("examples") or [])
        hint_level = int(payload.get("hintLevel") or 1)
        pieces = [
            f"Mode: {mode}",
            f"Mode guidance: {MODE_GUIDANCE[mode]}",
            f"Required response shape:\n{self._response_contract(mode, hint_level)}",
            f"Hint level: {hint_level}" if mode == "hint" else "",
            f"Preferred language: {payload.get('language') or 'C++'}",
            f"Student question: {payload.get('userQuestion')}" if payload.get("userQuestion") else "",
        ]

        if mode == "hint":
            pieces.append(
                "\n".join(
                    [
                        "Hint safety checklist:",
                        "- Match the exact title, statement, examples, and constraints below.",
                        "- Verify the approach against the first example before answering.",
                        "- Do not solve a different LeetCode question with a similar title.",
                        "- Prefer a safe next coding move over a broad theory explanation.",
                    ]
                )
            )

        if problem:
            pieces.append(
                "\n".join(
                    [
                        "Problem context:",
                        f"Title: {problem.get('title', '')}",
                        f"Frontend ID: {problem.get('questionFrontendId', '')}",
                        f"Difficulty: {problem.get('difficulty', '')}",
                        f"Tags: {', '.join(problem.get('tags') or [])}",
                        f"Statement: {problem.get('statement', '')}",
                        "Examples: " + "\n".join(examples),
                        "Constraints: " + "\n".join(problem.get("constraints") or []),
                    ]
                )
            )
        else:
            pieces.append("Problem context is missing. Ask the student to provide the problem statement instead of inventing it.")

        if payload.get("userCode"):
            pieces.append(f"Student code:\n{payload['userCode']}")

        return "\n\n".join(piece for piece in pieces if piece)

    def _response_contract(self, mode: str, hint_level: int = 1) -> str:
        if mode == "hint":
            if hint_level == 1:
                return "\n".join([
                    "Use this exact section order:",
                    "### Starting hint",
                    "Write 2 short sentences: first, what to notice in this exact problem; second, why that observation points to the next move.",
                    "### Try this next",
                    "Write 1 concrete action the student can code or decide now. It must be specific to the problem, not generic advice.",
                    "### Self-check",
                    "Write 1 short question the student can ask to know whether the direction is correct.",
                    "### Starter cue",
                    "Write exactly 1 short line in backticks.",
                    "The starter cue may be a formula, expression, loop condition, variable name, or invariant.",
                    "Do not include `std::`, imports, library names, class wrappers, semicolons, or full type declarations in the starter cue.",
                ])
            if hint_level == 2:
                return "\n".join([
                    "Use this exact section order:",
                    "### Directional hint",
                    "Write 2 to 3 short sentences naming the likely pattern and why it fits the given constraints/examples.",
                    "### Coding plan",
                    "Write exactly 3 numbered steps, using `1.`, `2.`, and `3.`.",
                    "Each step must be one short action the student can code next, not a paragraph.",
                    "Keep each step under 18 words and do not include full code.",
                    "### Checkpoint",
                    "Write 1 short sentence about the condition, update order, invariant, or edge case the student should verify.",
                    "Do not include code.",
                ])
            return "\n".join([
                "Use this exact section order:",
                "### Algorithm hint",
                "### Core idea",
                "Write 1 or 2 short sentences naming the state, structure, or pattern that solves this exact problem and why.",
                "### Steps",
                "Then write exactly 4 numbered steps.",
                "Each step must be plain English, problem-specific, and describe the solving algorithm instead of a dry run.",
                "### Edge check",
                "Write 1 edge case or sample condition the student should test after coding.",
                "Do not include code.",
            ])
        if mode == "explain":
            return "\n".join([
                "Use this exact section order:",
                "### Goal",
                "### Rules",
                "### Small example",
                "### What makes it tricky",
                "Do not give the algorithm.",
                "Do not give the direct solution steps.",
                "Do not include code.",
            ])
        if mode == "debug":
            return "\n".join([
                "Use this exact section order when relevant:",
                "### Issue",
                "### Why it breaks",
                "### Fix",
                "### Corrected code",
                "Leave one blank line after each heading.",
                "Keep the answer focused on the student's code, not generic advice.",
            ])
        if mode == "complexity":
            return "\n".join([
                "Use this exact section order:",
                "### Best for this question",
                "### Worst for this question",
                "If student code is present, also include `### Your code`.",
                "Leave one blank line after each heading.",
                "Keep the whole answer very short.",
                "Write every complexity in LaTeX, for example `\\( O(n \\log n) \\)`.",
            ])
        if mode == "optimize":
            return "\n".join([
                "Use this exact section order:",
                "### Current bottleneck",
                "### Better approach",
                "### Complexity change",
                "Write old and new complexities in LaTeX.",
            ])
        if mode == "full_solution":
            return "\n".join([
                "Use this exact section order:",
                "### Idea",
                "### Code",
                "### Complexity",
                "Leave one blank line after each heading.",
                "Return exactly one fenced code block.",
            ])
        if mode == "dry_run":
            return "\n".join([
                "Use this exact section order:",
                "### Example",
                "### Dry run",
                "Leave one blank line after each heading.",
                "Use numbered steps.",
                "Mention the actual values that change at each step.",
            ])
        return "\n".join([
            "Use short sections.",
            "Use LaTeX for formulas or complexity.",
            "Use fenced code blocks for code.",
        ])

    def _suggest_next_step(self, mode: str) -> str:
        if mode == "hint":
            return "Code the hinted next step first; ask for the next hint only if that checkpoint still blocks you."
        if mode == "debug":
            return "Run the corrected logic on one more edge case."
        if mode == "complexity":
            return "Compare your code complexity with the target best complexity for this problem."
        return "Ask for a dry run, hint, or code review if you want to go deeper."

    def _generate_progressive_hint(self, problem: dict[str, Any] | None, hint_level: int) -> str | None:
        if not problem:
            return None

        tags = [tag.lower() for tag in problem.get("tags", [])]
        title = problem.get("title", "this problem")
        statement = (problem.get("statement") or "").lower()
        example = self._extract_example_text(problem)

        def level_one(notice: str, try_next: str, self_check: str, cue: str) -> str:
            return "\n".join([
                "### Starting hint",
                notice,
                "",
                "### Try this next",
                try_next,
                "",
                "### Self-check",
                self_check,
                "",
                "### Starter cue",
                f"`{cue}`",
            ])

        def level_two(direction: str, plan: list[str], checkpoint: str) -> str:
            return "\n".join([
                "### Directional hint",
                direction,
                "",
                "### Coding plan",
                *(f"{index}. {step}" for index, step in enumerate(plan[:3], start=1)),
                "",
                "### Checkpoint",
                checkpoint,
            ])

        def level_three(core_idea: str, steps: list[str], edge_check: str) -> str:
            return "\n".join([
                "### Algorithm hint",
                "### Core idea",
                core_idea,
                "",
                "### Steps",
                *(f"{index}. {step}" for index, step in enumerate(steps[:4], start=1)),
                "",
                "### Edge check",
                edge_check,
            ])

        if "hash table" in tags:
            if hint_level == 1:
                return level_one(
                    "A hash table tag only tells you that repeated lookup may matter; it does not tell you what the key should be. Find the exact question the brute force repeats.",
                    "Write one sentence naming the lookup key and the information its value must remember.",
                    "Would two inputs that share this key always be interchangeable for the remaining work?",
                    "lookup_key = information_needed_later",
                )
            if hint_level == 2:
                return level_two(
                    "Use a lookup table only after defining the problem-specific key. The value might be a count, index, group, or best result; derive that from the statement rather than the tag.",
                    [
                        "Name the repeated lookup performed by the brute-force approach.",
                        "Choose a canonical key that makes equivalent inputs match.",
                        "Store only the information required to answer the next lookup.",
                    ],
                    "Check whether update order changes the result when the same key appears more than once.",
                )
            return level_three(
                "Replace the repeated lookup in the brute-force approach with a table whose key and stored value are derived from the exact statement.",
                [
                    "Identify the repeated question that makes the direct approach slow.",
                    "Define a canonical lookup key for that question.",
                    "Query or update the stored count, index, group, or state in the required order.",
                    "Build the final result from the completed table or the matches found during traversal.",
                ],
                "Test duplicate keys and two different inputs that should map to the same key.",
            )

        if "two pointers" in tags and "linked list" in tags:
            if hint_level == 1:
                return level_one(
                    "Notice that the answer depends on a position inside the linked list, not on sorting or random access. You need pointers that reveal that position while preserving the links.",
                    "Decide what `slow`, `fast`, and possibly `prev` should mean before changing any `next` pointer.",
                    "When the loop stops, which pointer is on the node you must edit or remove?",
                    "while fast and fast.next:",
                )
            if hint_level == 2:
                return level_two(
                    "Two pointers fit because one pointer can measure progress while the other lands on the important node. Keep a previous pointer if the final operation needs relinking.",
                    [
                        "Initialize the pointers so their distance or speed difference matches the target position.",
                        "Move them together until the fast pointer reaches the chosen stop condition.",
                        "Use the slow pointer and previous pointer to perform the link update.",
                    ],
                    "Before reconnecting links, confirm what happens when the head itself is the target.",
                )
            return level_three(
                "Use two pointers to locate the target node in one traversal, then update the surrounding link cleanly.",
                [
                    "Initialize the pointer setup required by the position you need to find.",
                    "Move the pointers until the fast pointer reaches the stop condition that proves slow is correctly placed.",
                    "Use the pointer before the target to reconnect the list around the target node.",
                    "Return the correct head, including the case where the original head changed.",
                ],
                "Test a one-node list or a case where the head is removed.",
            )

        if "binary search" in tags:
            if hint_level == 1:
                return level_one(
                    "Notice whether the problem has a sorted range, monotonic condition, or answer space where once something becomes true it stays true. That is the real reason binary search may apply.",
                    "Write down what `left` and `right` mean in this problem, then write the middle candidate.",
                    "If you test `mid`, can you prove which side can be discarded?",
                    "mid = left + (right - left) // 2",
                )
            if hint_level == 2:
                return level_two(
                    "Binary search fits only if your check on `mid` is monotonic. The goal is to turn the problem into a yes/no test that safely eliminates half.",
                    [
                        "Define the meaning of the search bounds in words.",
                        "Write the condition that tests whether `mid` is too small, too large, or valid.",
                        "Update exactly one bound in each branch so the interval shrinks.",
                    ],
                    "Can your loop get stuck when only two candidates remain?",
                )
            return level_three(
                "Binary search works when one test on the middle candidate tells you which half of the remaining search space is still valid.",
                [
                    "Set the low and high boundaries of the valid search space.",
                    "Compute the middle candidate each round.",
                    "Evaluate the middle candidate and discard the invalid half.",
                    "Stop when the bounds converge or the exact target is found, depending on the problem goal.",
                ],
                "Test the smallest input and a case where the answer is at the boundary.",
            )

        if "dynamic programming" in tags:
            if hint_level == 1:
                return level_one(
                    "Notice whether the same smaller decisions repeat across the problem. DP starts by naming exactly what one saved answer means.",
                    "Before transitions, write a sentence for `dp[i]` or `dp[i][j]` in terms of the input.",
                    "Can you explain one DP cell without saying 'the answer so far' vaguely?",
                    "dp[i] = best answer using the first i positions/items",
                )
            if hint_level == 2:
                return level_two(
                    "DP fits when the answer for a larger prefix/state can be built from earlier states. The hard part is choosing a state that contains enough information but not too much.",
                    [
                        "Define the DP state in one precise sentence.",
                        "List the previous states that can transition into the current state.",
                        "Choose a fill order where those previous states are already computed.",
                    ],
                    "If two different histories lead to the same DP state, do they need the same future information?",
                )
            return level_three(
                "Store answers for smaller states and reuse them so repeated subproblems are solved once.",
                [
                    "Define the DP state so each entry has one clear meaning.",
                    "Set the base cases from the smallest valid inputs.",
                    "Write the transition using only states that are already known.",
                    "Return the state that represents the complete input.",
                ],
                "Test the smallest input because DP bugs usually start in base cases.",
            )

        if "graph" in tags or "breadth-first search" in tags or "depth-first search" in tags:
            if hint_level == 1:
                return level_one(
                    f"Notice what a single state represents in {title}: a node, position, index, mask, or configuration. Once the state is clear, traversal becomes much less mysterious.",
                    "Write what counts as a neighbor from one state before choosing BFS or DFS.",
                    "Could the same state be reached twice? If yes, what identifies it uniquely?",
                    "visited.add(state)",
                )
            if hint_level == 2:
                return level_two(
                    "Graph traversal fits when the problem is about moving between valid states. Use BFS for shortest steps and DFS for reachability or full exploration.",
                    [
                        "Define the state and how to generate its neighbors.",
                        "Initialize the queue or stack with the starting state.",
                        "Mark visited states consistently so cycles or repeated paths do not explode.",
                    ],
                    "Mark a state when you enqueue/push it unless the problem specifically needs a different timing.",
                )
            return level_three(
                "Model valid positions or configurations as states, then traverse each reachable state once.",
                [
                    "Define what one state contains.",
                    "Generate all valid neighbors from that state.",
                    "Traverse with BFS or DFS while preventing revisits.",
                    "Return the distance, count, or found condition required by the problem.",
                ],
                "Test a case with a cycle, blocked move, or repeated state.",
            )

        if "math" in tags or "geometry" in tags or "simulation" in tags:
            if "clock" in statement and "angle" in statement:
                if hint_level == 1:
                    return level_one(
                        "Notice that both clock hands can be converted into angles from 12 o'clock. The hour hand also moves while minutes pass, so it is not just `30 * hour`.",
                        "Compute the minute angle and hour angle separately before comparing them.",
                        "Does your hour angle change when `minutes` changes?",
                        "minute_angle = 6 * minutes; hour_angle = 30 * (hour % 12) + 0.5 * minutes",
                    )
                if hint_level == 2:
                    return level_two(
                        "This is a formula problem: compute both hand angles, then handle the circular distance. The final comparison is between the direct gap and the wraparound gap.",
                        [
                            "Convert minutes to degrees using 6 degrees per minute.",
                            "Convert hours to degrees and add the extra minute movement.",
                            "Take the smaller of `diff` and `360 - diff`.",
                        ],
                        "Treat `12` like `0` on the clock face.",
                    )
                return level_three(
                    "Turn the problem into two angle computations, then take the smaller circular distance between them.",
                    [
                        "Convert the minute value into the minute-hand angle.",
                        "Convert the hour and minute values into the hour-hand angle, including minute movement.",
                        "Compute the absolute difference between the two angles.",
                        "Return the smaller value between that difference and the full-circle complement.",
                    ],
                    "Test `12:00`, because both hands should produce angle `0`.",
                )

            if hint_level == 1:
                return level_one(
                    "Notice which quantities actually change and which are fixed by the input. Math and simulation problems become easier when each changing quantity gets its own formula or update rule.",
                    "Name the first value you can compute directly from the input before combining everything.",
                    "Are all quantities using the same units and indexing convention?",
                    "value_after_step = previous_value + current_contribution",
                )
            if hint_level == 2:
                return level_two(
                    "Break the problem into the few quantities that change, compute each separately, and combine them at the end. Handle wraparound, bounds, or formatting after the main calculation.",
                    [
                        "List the changing quantities and their starting values.",
                        "Write the update rule for one step or one input item.",
                        "Apply the final adjustment requested by the statement.",
                    ],
                    "Check units, indexing, and whether the answer needs min/max or wraparound handling.",
                )
            return level_three(
                "Compute the core quantities directly from the input, then apply the final comparison or adjustment the statement requires.",
                [
                    "Identify the exact values that can be computed directly from the input.",
                    "Write the formula or update rule for each value separately.",
                    "Combine those values to produce the raw answer.",
                    "Apply any final minimization, wraparound, or formatting rule before returning.",
                ],
                "Test a boundary value such as zero, one item, or a maximum/minimum input.",
            )

        if hint_level == 1:
            starting_line = f"Start by restating what one step of progress looks like in {title}."
            if example:
                starting_line += f" Use the first sample as your guide: {example}"
            return level_one(
                f"{starting_line} Then ask what information you wish you already knew before making the next decision.",
                "Write down the repeated decision in the problem, then name the state that would make that decision easier.",
                "After one element or step, what changes and what must stay remembered?",
                "track_the_state_you_need_before_the_next_step",
            )
        if hint_level == 2:
            return level_two(
                "Focus on the repeated decision in the problem and decide what must be tracked before moving forward. Once that tracked state is clear, the flow usually becomes one pass, ordered traversal, search, or DP.",
                [
                    "State the repeated decision in plain English.",
                    "Choose the smallest state or helper structure that answers that decision.",
                    "Process the input in the order that keeps the state useful.",
                ],
                "You should be able to explain what changes after every step and why that helps the next step.",
            )
        return level_three(
            "Identify the minimum state or helper structure that removes repeated work, then process the input in the order that keeps that state useful.",
            [
                "Identify the exact state or helper structure you need to maintain.",
                "Process the input in the order that makes earlier work reusable.",
                "Update that state after each step according to the current element or condition.",
                "Return the final value once the traversal, search, or construction is complete.",
            ],
            "Test the smallest valid input and one case where the obvious greedy choice might fail.",
        )

    def _generate_concise_explanation(self, problem: dict[str, Any] | None) -> str | None:
        if not problem:
            return None

        statement = (problem.get("statement") or "").strip()
        statement = re.sub(r"\s+", " ", statement)
        if len(statement) > 220:
            statement = statement[:220].rsplit(" ", 1)[0] + "..."

        example = ""
        if problem.get("examples"):
            example = problem["examples"][0].strip()
            example = re.sub(r"\s+", " ", example)
            if len(example) > 160:
                example = example[:160].rsplit(" ", 1)[0] + "..."

        constraints = [str(item).strip() for item in (problem.get("constraints") or []) if str(item).strip()]
        tricky_point = self._tricky_point(problem)

        lines = [
            "### Goal",
            statement or "Understand the input and return the required answer.",
            "",
            "### Rules",
        ]
        if constraints:
            lines.extend(f"- {constraint}" for constraint in constraints[:3])
        else:
            lines.append("- Read the input carefully and return exactly what the statement asks for.")
        if example:
            lines.extend(["", "### Small example", example])
        else:
            lines.extend(["", "### Small example", "Use the first sample from LeetCode to confirm what the input and output look like."])
        lines.extend(["", "### What makes it tricky", tricky_point])
        return "\n".join(lines)

    def _tricky_point(self, problem: dict[str, Any]) -> str:
        tags = [tag.lower() for tag in problem.get("tags", [])]
        statement = f"{problem.get('title', '')} {problem.get('statement', '')}".lower()

        if "clock" in statement and "angle" in statement:
            return "The hour hand does not jump once per hour; it keeps moving as the minutes pass, so both hands need separate angle calculations."
        if "hash table" in tags:
            return "The trap is doing repeated pair checks instead of asking whether the needed partner has already been seen."
        if "binary search" in tags:
            return "The difficult part is defining the condition that lets you safely discard one half every step."
        if "dynamic programming" in tags:
            return "The main challenge is choosing a DP state whose meaning is clear before you write any transition."
        if "two pointers" in tags:
            return "Two pointers only work when you know exactly what makes each pointer move and what invariant remains true."
        if "graph" in tags or "breadth-first search" in tags or "depth-first search" in tags:
            return "You must define what counts as one state and mark visited work at the right moment so exploration does not repeat."
        if "math" in tags or "simulation" in tags:
            return "The trick is to translate the wording into exact quantities or formulas before you combine them."
        return "The wording may sound simple, but the real work is identifying the state, formula, or condition that should be tracked."

    def _max_tokens_for_mode(self, mode: str) -> int:
        if mode == "hint":
            return 420
        if mode == "explain":
            return 220
        if mode == "complexity":
            return 180
        if mode == "dry_run":
            return 650
        if mode in {"debug", "optimize"}:
            return 900
        if mode == "full_solution":
            return 1100
        return 400

    def _fallback_for_mode(self, payload: dict[str, Any]) -> str | None:
        mode = payload.get("mode")
        problem = payload.get("problem") or {}
        code = (payload.get("userCode") or "").strip()

        if mode == "hint":
            hint_level = int(payload.get("hintLevel") or 1)
            return self._generate_progressive_hint(problem, hint_level)
        if mode == "explain":
            return self._generate_concise_explanation(problem)
        if mode == "debug":
            return self._generate_debug_fallback(problem, code)
        return None

    def _generate_debug_fallback(self, problem: dict[str, Any], code: str) -> str:
        if not code:
            return "### Missing code\nPlease paste your code so I can review it properly."

        title = problem.get("title", "this problem")
        hints: list[str] = []
        if "return {}" in code or "return {};" in code:
            hints.append("Your fallback return suggests some paths may not produce an answer cleanly.")
        if "for(" in code or "for (" in code:
            hints.append("Check whether every loop update and lookup order matches the intended logic.")
        if "unordered_map" in code or "HashMap" in code or "dict" in code:
            hints.append("When using a hash map, make sure you check the needed value before overwriting the current value.")
        if code.count("left") and code.count("right"):
            hints.append("For two-pointer logic, verify which condition moves the left pointer and which moves the right pointer.")
        if "mid" in code and ("left" in code or "low" in code):
            hints.append("In binary search, confirm the loop condition and make sure the search bounds always shrink.")
        if code.count("return") == 0:
            hints.append("The function may compute useful state but never return the final answer clearly.")

        if not hints:
            hints.append("The main risk is usually incorrect update order, missed edge cases, or returning too early.")

        return "\n".join([
            "### Review summary",
            f"Your code for **{title}** looks close, but review the operation order and edge-case handling carefully.",
            "",
            "### Likely issue",
            f"- {hints[0]}",
            "",
            "### Failing case to check",
            "- Try the smallest valid input and one case where the answer appears immediately after the first element.",
            "",
            "### What to verify",
            "- Are you checking before updating shared state?",
            "- Are duplicate values handled correctly?",
            "- Does every valid path return the expected answer?",
        ])

    def _extract_example_text(self, problem: dict[str, Any]) -> str:
        examples = problem.get("examples") or []
        if not examples:
            return ""
        example = re.sub(r"\s+", " ", examples[0]).strip()
        return example[:240].rsplit(" ", 1)[0] + "..." if len(example) > 240 else example


ai_service = AIService()
