import os
import re
from typing import Any

import requests

from .hints import HINT_TEXT
from .prompts import ASSISTANT_SYSTEM_PROMPT, MODE_GUIDANCE, HINT_RESPONSE_FORMATS, RESPONSE_FORMATS


DEFAULT_MODEL = "llama-3.3-70b-versatile"
MODEL_FALLBACKS = (
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "llama-3.1-8b-instant",
)
GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions"


class AIService:
    def get_answer(self, payload: dict[str, Any]) -> dict[str, Any]:
        self._validate_payload(payload)
        mode = payload["mode"]
        fallback = self._fallback_for_mode(payload)
        api_key = os.environ.get("GROQ_API_KEY")

        try:
            if not api_key:
                raise ValueError("Missing GROQ_API_KEY. Add it to your root .env file.")
            answer = self._request_groq(payload, api_key)
        except ValueError:
            if not fallback:
                raise
            answer = fallback

        if fallback and mode in {"hint", "explain"}:
            invalid_answer = len(answer) < 40 or "```" in answer
            if mode == "hint":
                hint_level = payload.get("hintLevel", 1)
                invalid_answer = invalid_answer or not self._valid_hint(answer, hint_level)
            else:
                invalid_answer = invalid_answer or not self._valid_explanation(answer)
                invalid_answer = invalid_answer or "### Code" in answer or "Algorithm hint" in answer
            if invalid_answer:
                answer = fallback

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

    def _valid_hint(self, answer: str, hint_level: int) -> bool:
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

    def _valid_explanation(self, answer: str) -> bool:
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
        configured = os.environ.get("AI_MODEL") or DEFAULT_MODEL
        models = []
        for model in (configured, DEFAULT_MODEL, *MODEL_FALLBACKS):
            model = model.strip()
            if model and model not in models:
                models.append(model)
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
            f"Required response shape:\n{self._answer_format(mode, hint_level)}",
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

    def _answer_format(self, mode: str, hint_level: int = 1) -> str:
        if mode == "hint":
            return HINT_RESPONSE_FORMATS.get(hint_level, HINT_RESPONSE_FORMATS[3])
        return RESPONSE_FORMATS.get(mode, RESPONSE_FORMATS["default"])

    def _suggest_next_step(self, mode: str) -> str:
        if mode == "hint":
            return "Code the hinted next step first; ask for the next hint only if that checkpoint still blocks you."
        if mode == "debug":
            return "Run the corrected logic on one more edge case."
        if mode == "complexity":
            return "Compare your code complexity with the target best complexity for this problem."
        return "Ask for a dry run, hint, or code review if you want to go deeper."

    def _local_hint(self, problem: dict[str, Any] | None, hint_level: int) -> str | None:
        if not problem:
            return None

        tags = [tag.lower() for tag in problem.get("tags", [])]
        statement = (problem.get("statement") or "").lower()
        topic = "general"
        if "hash table" in tags:
            topic = "hash table"
        elif "two pointers" in tags and "linked list" in tags:
            topic = "linked list"
        elif "binary search" in tags:
            topic = "binary search"
        elif "dynamic programming" in tags:
            topic = "dynamic programming"
        elif any(tag in tags for tag in ("graph", "breadth-first search", "depth-first search")):
            topic = "graph"
        elif any(tag in tags for tag in ("math", "geometry", "simulation")):
            topic = "clock" if "clock" in statement and "angle" in statement else "math"

        title = problem.get("title", "this problem")
        starting_line = f"Start by restating what one step of progress looks like in {title}."
        example = self._example_text(problem)
        if example:
            starting_line += f" Use the first sample as your guide: {example}"
        level = hint_level if hint_level in (1, 2) else 3
        return HINT_TEXT[topic][level].format(title=title, starting_line=starting_line)

    def _local_explanation(self, problem: dict[str, Any] | None) -> str | None:
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
        limits = {
            "hint": 420, "explain": 220, "complexity": 180,
            "dry_run": 650, "debug": 900, "optimize": 900, "full_solution": 1100,
        }
        return limits.get(mode, 400)

    def _fallback_for_mode(self, payload: dict[str, Any]) -> str | None:
        mode = payload.get("mode")
        problem = payload.get("problem") or {}
        code = (payload.get("userCode") or "").strip()

        if mode == "hint":
            hint_level = int(payload.get("hintLevel") or 1)
            return self._local_hint(problem, hint_level)
        if mode == "explain":
            return self._local_explanation(problem)
        if mode == "debug":
            return self._local_code_review(problem, code)
        return None

    def _local_code_review(self, problem: dict[str, Any], code: str) -> str:
        if not code:
            return "### Missing code\nPlease paste your code so I can review it properly."

        title = problem.get("title", "this problem")
        if "return {}" in code or "return {};" in code:
            warning = "Your fallback return suggests some paths may not produce an answer cleanly."
        elif "for(" in code or "for (" in code:
            warning = "Check whether every loop update and lookup order matches the intended logic."
        elif "unordered_map" in code or "HashMap" in code or "dict" in code:
            warning = "When using a hash map, make sure you check the needed value before overwriting the current value."
        elif "left" in code and "right" in code:
            warning = "For two-pointer logic, verify which condition moves the left pointer and which moves the right pointer."
        elif "mid" in code and ("left" in code or "low" in code):
            warning = "In binary search, confirm the loop condition and make sure the search bounds always shrink."
        elif "return" not in code:
            warning = "The function may compute useful state but never return the final answer clearly."

        else:
            warning = "The main risk is usually incorrect update order, missed edge cases, or returning too early."


        return "\n".join([
            "### Review summary",
            f"Your code for **{title}** looks close, but review the operation order and edge-case handling carefully.",
            "",
            "### Likely issue",
            f"- {warning}",
            "",
            "### Failing case to check",
            "- Try the smallest valid input and one case where the answer appears immediately after the first element.",
            "",
            "### What to verify",
            "- Are you checking before updating shared state?",
            "- Are duplicate values handled correctly?",
            "- Does every valid path return the expected answer?",
        ])

    def _example_text(self, problem: dict[str, Any]) -> str:
        examples = problem.get("examples") or []
        if not examples:
            return ""
        example = re.sub(r"\s+", " ", examples[0]).strip()
        return example[:240].rsplit(" ", 1)[0] + "..." if len(example) > 240 else example


ai_service = AIService()
