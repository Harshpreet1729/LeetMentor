from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html import unescape
from typing import Any

import requests


DEFAULT_GRAPHQL_URL = "https://leetcode.com/graphql"
DEFAULT_MODEL = "llama-3.3-70b-versatile"
MODEL_FALLBACKS = (
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "llama-3.1-8b-instant",
)
GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions"
ALL_PROBLEMS_ENDPOINT = "https://leetcode.com/api/problems/all/"
LEETCODE_BASE_URL = "https://leetcode.com"

DAILY_QUERY = """
query questionOfToday {
  activeDailyCodingChallengeQuestion {
    date
    userStatus
    link
    question {
      questionFrontendId
      title
      titleSlug
      difficulty
      content
      topicTags {
        name
      }
      stats
      exampleTestcases
      hints
    }
  }
}
"""

PROBLEM_QUERY = """
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    titleSlug
    difficulty
    content
    topicTags {
      name
    }
    stats
    exampleTestcases
    hints
  }
}
"""

SEARCH_QUERY = """
query problemsetQuestionList($search: String!) {
  problemsetQuestionList(
    categorySlug: ""
    limit: 10
    skip: 0
    filters: { searchKeywords: $search }
  ) {
    questions {
      questionFrontendId
      title
      titleSlug
    }
  }
}
"""

ASSISTANT_SYSTEM_PROMPT = """You are a student-friendly LeetCode DSA assistant.
Your goal is to help students learn, not just copy answers.
Always explain in simple language.
If the student asks for a hint, give only a hint and do not reveal the full solution.
If the student shares code, first identify what the code is trying to do, then find mistakes, then explain the fix.
Never invent problem statements.
Use only the provided problem context.
If context is missing, ask the student to provide the problem statement.
Prefer C++ unless the student asks for another language.
Keep explanations beginner-friendly and placement-focused.
Be precise and concrete. Do not give generic advice when the code or problem context is available.

Response rules:
- Start with the direct answer, not with filler.
- Use short markdown headings like `### Issue`, `### Fix`, `### Complexity`, `### Code`.
- Put each heading on its own line, then leave one blank line before the content.
- Never put prose, numbered steps, or a code fence on the same line as a heading.
- If you mention complexity, formulas, recurrence relations, or numeric expressions, write them in LaTeX using `\\( ... \\)` or `\\[ ... \\]`.
- Never leave formulas in plain text if LaTeX would make them clearer.
- Any code must be inside fenced code blocks with the language tag.
- Use bullets or numbered lists instead of one long paragraph whenever you explain steps.
- When referring to a specific expression, variable, or code line, wrap it in backticks.
- Prefer compact answers over long essays.
- Do not shame the student.
- Do not overcomplicate beginner explanations.
- Hints must help the student take the first real step, not just restate the idea in English.
- For hint mode, stay short, specific, problem-aware, and never include full code.
- For hint level 1, use the headings `### Starting hint` and `### Starter cue`. The starter cue must be exactly one short line in backticks that shows the first useful formula, expression, or variable setup.
- For hint level 2, use the headings `### Directional hint` and `### Checkpoint`. Describe the approach flow and the next condition, update, or invariant the student should verify.
- For hint level 3, use the headings `### Algorithm hint`, `### Core idea`, and `### Steps`. Give the actual solving plan with exactly 4 numbered steps. It is not a dry run and should not walk through sample values.
- For dry run mode, use the actual sample values from the problem whenever possible.
- For complexity mode, analyze the student's code if it is present. If it is absent, clearly say you are assuming the standard approach."""

MODE_GUIDANCE = {
    "hint": "Give a progressive hint only. Respect hint level exactly. Make the hint actionable enough for the student to begin writing. Level 1 must include one tiny starter cue line in backticks. Level 3 must describe the solving algorithm, not a dry run. Do not use full code.",
    "explain": "Explain only what the problem is asking. Clarify the goal, the important rules, one small example, and the subtle point students often miss. Do not give the algorithm, the direct solution steps, or code.",
    "debug": "Review the student's actual code. Identify the exact bug, explain why it fails on one concrete case, and show the corrected version in a fenced code block only if needed.",
    "complexity": "State the best target complexity for this exact problem, the likely brute-force worst complexity for this exact problem, and if the student pasted code, also estimate the current code complexity. Keep it short, specific, and complexity-focused only.",
    "dry_run": "Dry run one real sample from the problem. Use the actual values from the example, show the changing state clearly, and explain what each step is doing.",
    "full_solution": "Provide the optimal solution with short intuition, one clean code block, and explicit LaTeX complexity.",
    "optimize": "Compare the current approach with a better one. State old and new complexities in LaTeX and explain the upgrade path without fluff.",
}


@dataclass
class ProblemContext:
    title: str
    title_slug: str
    question_frontend_id: str
    difficulty: str
    tags: list[str]
    link: str
    statement: str
    examples: list[str]
    constraints: list[str]
    example_cards: list[dict[str, Any]]
    acceptance_rate: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "titleSlug": self.title_slug,
            "questionFrontendId": self.question_frontend_id,
            "difficulty": self.difficulty,
            "tags": self.tags,
            "link": self.link,
            "statement": self.statement,
            "examples": self.examples,
            "constraints": self.constraints,
            "exampleCards": self.example_cards,
            "acceptanceRate": self.acceptance_rate,
        }


class LeetCodeService:
    def __init__(self) -> None:
        self.cache: dict[str, ProblemContext] = {}
        self.problem_index_cache: list[dict[str, str]] | None = None

    def get_daily_challenge(self) -> ProblemContext:
        payload = self._graphql_request(DAILY_QUERY, {})
        daily = payload.get("data", {}).get("activeDailyCodingChallengeQuestion")
        if not daily or not daily.get("question"):
            raise ValueError("Daily problem not found from LeetCode.")

        problem = self._map_question(daily["question"], daily["link"])
        self._cache_problem(problem)
        return problem

    def get_problem(self, identifier: str) -> ProblemContext:
        normalized = identifier.strip()
        if not normalized:
            raise ValueError("Empty query. Enter a problem number, title slug, title, or LeetCode URL.")

        if normalized in self.cache:
            return self.cache[normalized]

        slug = self._resolve_slug(normalized)
        if slug in self.cache:
            return self.cache[slug]

        payload = self._graphql_request(PROBLEM_QUERY, {"titleSlug": slug})
        question = payload.get("data", {}).get("question")
        if not question:
            raise ValueError("Problem not found. Please check the problem number, slug, title, or URL.")

        problem = self._map_question(question, f"/problems/{question['titleSlug']}/")

        self._cache_problem(problem)
        return problem

    def _resolve_slug(self, identifier: str) -> str:
        if identifier.startswith("http"):
            parsed = urllib.parse.urlparse(identifier)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("Invalid URL. Please paste a valid LeetCode problem URL.")
            if "leetcode.com" not in parsed.netloc.lower():
                raise ValueError("Invalid URL. Only LeetCode problem URLs are supported.")

            parts = [part for part in parsed.path.split("/") if part]
            if "problems" in parts:
                index = parts.index("problems")
                if index + 1 < len(parts):
                    return parts[index + 1]
            raise ValueError("Invalid URL. Expected a LeetCode problem URL like https://leetcode.com/problems/two-sum/.")

        if re.fullmatch(r"[a-z0-9-]+", identifier, flags=re.IGNORECASE) and not identifier.isdigit():
            return identifier.lower()

        indexed_slug = self._lookup_slug_from_problem_index(identifier)
        if indexed_slug:
            return indexed_slug

        try:
            search_slug = self._search_slug(identifier)
            if search_slug:
                return search_slug
        except ValueError:
            pass

        if identifier.isdigit():
            raise ValueError("Problem number lookup failed. Try the title, slug, or URL.")

        return re.sub(r"\s+", "-", re.sub(r"[^a-z0-9\s-]", "", identifier.lower()).strip())

    def _lookup_slug_from_problem_index(self, identifier: str) -> str | None:
        normalized = identifier.strip().lower()
        for entry in self._get_problem_index():
            normalized_title = entry["title"].lower()
            slug_like_title = re.sub(r"\s+", "-", re.sub(r"[^a-z0-9\s-]", "", normalized_title).strip())
            if (
                entry["frontendId"] == normalized
                or entry["titleSlug"].lower() == normalized
                or normalized_title == normalized
                or slug_like_title == normalized
            ):
                return entry["titleSlug"]
        return None

    def _get_problem_index(self) -> list[dict[str, str]]:
        if self.problem_index_cache is not None:
            return self.problem_index_cache

        request = urllib.request.Request(
            ALL_PROBLEMS_ENDPOINT,
            headers=self._default_headers(f"{LEETCODE_BASE_URL}/problemset/"),
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.URLError:
            self.problem_index_cache = []
            return self.problem_index_cache

        pairs = data.get("stat_status_pairs", [])
        self.problem_index_cache = [
            {
                "frontendId": str(item["stat"]["frontend_question_id"]),
                "title": item["stat"]["question__title"],
                "titleSlug": item["stat"]["question__title_slug"],
            }
            for item in pairs
        ]
        return self.problem_index_cache

    def _search_slug(self, identifier: str) -> str | None:
        payload = self._graphql_request(SEARCH_QUERY, {"search": identifier})
        questions = payload.get("data", {}).get("problemsetQuestionList", {}).get("questions", [])
        normalized = identifier.strip().lower()
        for question in questions:
            if (
                question["questionFrontendId"].lower() == normalized
                or question["title"].lower() == normalized
                or question["titleSlug"].lower() == normalized
            ):
                return question["titleSlug"]
        return questions[0]["titleSlug"] if questions else None

    def _map_question(self, question: dict[str, Any], link: str) -> ProblemContext:
        stats = json.loads(question["stats"]) if question.get("stats") else {}
        statement, examples, constraints, example_cards = self._extract_sections(question.get("content") or "")
        return ProblemContext(
            title=question["title"],
            title_slug=question["titleSlug"],
            question_frontend_id=question["questionFrontendId"],
            difficulty=question["difficulty"],
            tags=[tag["name"] for tag in question.get("topicTags", [])],
            link=link if link.startswith("http") else f"https://leetcode.com{link}",
            statement=statement,
            examples=examples,
            constraints=constraints,
            example_cards=example_cards,
            acceptance_rate=self._parse_acceptance_rate(stats.get("acRate")),
        )

    def _extract_sections(self, content: str) -> tuple[str, list[str], list[str], list[dict[str, Any]]]:
        plain_text = self._normalize_problem_text(self._html_to_text(content))

        statement_match = re.split(r"\bExample\s+\d+\s*:", plain_text, maxsplit=1, flags=re.IGNORECASE)
        statement = self._normalize_problem_text(statement_match[0])
        statement = re.sub(r"\bConstraints\s*:\s*$", "", statement, flags=re.IGNORECASE).strip()

        example_cards: list[dict[str, Any]] = []
        raw_examples = re.findall(
            r"Example\s+(\d+)\s*:\s*([\s\S]*?)(?=Example\s+\d+\s*:|Constraints\s*:|$)",
            plain_text,
            flags=re.IGNORECASE,
        )
        for number, block in raw_examples:
            card = self._parse_example_block(block, number)
            if card:
                example_cards.append(card)

        examples = [self._example_card_to_text(card) for card in example_cards]

        constraints: list[str] = []
        constraint_match = re.search(r"Constraints\s*:\s*([\s\S]*)$", plain_text, flags=re.IGNORECASE)
        if constraint_match:
            constraints = self._extract_constraint_lines(constraint_match.group(1))

        return statement, examples, constraints, example_cards

    def _html_to_text(self, content: str) -> str:
        text = content
        text = re.sub(r"<sup>(.*?)</sup>", r"^\1", text, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<sub>(.*?)</sub>", r"_\1", text, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</(p|div|section|article|pre|ul|ol|table|thead|tbody|tfoot|tr|h1|h2|h3|h4|h5|h6)>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"<li[^>]*>", "- ", text, flags=re.IGNORECASE)
        text = re.sub(r"</li>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</(td|th)>", " | ", text, flags=re.IGNORECASE)
        text = re.sub(r"<(td|th)[^>]*>", "", text, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        text = unescape(text)
        text = text.replace("\xa0", " ")
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n[ \t]+", "\n", text)
        text = re.sub(r"[ \t]{2,}", " ", text)
        return text

    def _normalize_problem_text(self, text: str) -> str:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"\s+([,.;:!?])", r"\1", text)
        text = re.sub(r"\(\s+", "(", text)
        text = re.sub(r"\s+\)", ")", text)
        return text.strip()

    def _parse_example_block(self, block: str, number: str) -> dict[str, Any] | None:
        cleaned = self._normalize_problem_text(block)
        if not cleaned:
            return None

        sections: dict[str, str] = {}
        labels = ("Input", "Output", "Explanation")
        for label in labels:
            match = re.search(
                rf"{label}\s*:\s*([\s\S]*?)(?=(?:Input|Output|Explanation)\s*:|$)",
                cleaned,
                flags=re.IGNORECASE,
            )
            if match:
                sections[label.lower()] = self._normalize_problem_text(match.group(1))

        if sections:
            consumed = cleaned
            for label in labels:
                consumed = re.sub(
                    rf"{label}\s*:\s*([\s\S]*?)(?=(?:Input|Output|Explanation)\s*:|$)",
                    "",
                    consumed,
                    flags=re.IGNORECASE,
                )
            notes = [line.strip(" -") for line in self._normalize_problem_text(consumed).splitlines() if line.strip(" -")]
            card = {
                "title": f"Example {number}",
                "input": sections.get("input", ""),
                "output": sections.get("output", ""),
                "explanation": sections.get("explanation", ""),
                "notes": notes,
            }
            return card

        lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
        return {
            "title": f"Example {number}",
            "body": "\n".join(lines),
        }

    def _example_card_to_text(self, card: dict[str, Any]) -> str:
        pieces = [card.get("title", "Example")]
        if card.get("input"):
            pieces.append(f"Input: {card['input']}")
        if card.get("output"):
            pieces.append(f"Output: {card['output']}")
        if card.get("explanation"):
            pieces.append(f"Explanation: {card['explanation']}")
        for note in card.get("notes") or []:
            pieces.append(note)
        if card.get("body"):
            pieces.append(card["body"])
        return "\n".join(piece for piece in pieces if piece)

    def _extract_constraint_lines(self, raw_text: str) -> list[str]:
        cleaned = self._normalize_problem_text(raw_text)
        if not cleaned:
            return []

        constraints: list[str] = []
        for raw_line in cleaned.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            line = re.sub(r"^[\-*]\s*", "", line)
            line = re.sub(r"\s+\|\s*$", "", line)
            if line:
                constraints.append(line)
        return constraints

    def _cache_problem(self, problem: ProblemContext) -> None:
        for identifier in (
            problem.title_slug,
            problem.question_frontend_id,
            problem.title,
            f"{LEETCODE_BASE_URL}/problems/{problem.title_slug}/",
        ):
            self.cache[identifier] = problem

    def _graphql_request(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        url = os.environ.get("LEETCODE_GRAPHQL_URL", DEFAULT_GRAPHQL_URL)
        request = urllib.request.Request(
            url,
            data=json.dumps({"query": query, "variables": variables}).encode("utf-8"),
            headers={
                **self._default_headers(LEETCODE_BASE_URL),
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise ValueError(f"LeetCode request failed with status {error.code}.") from error
        except urllib.error.URLError as error:
            raise ValueError("Could not reach LeetCode. Check your internet connection and try again.") from error

        errors = payload.get("errors") or []
        if errors:
            first_message = errors[0].get("message") if isinstance(errors[0], dict) else None
            raise ValueError(first_message or "LeetCode request failed.")

        return payload

    def _default_headers(self, referer: str) -> dict[str, str]:
        return {
            "Referer": referer,
            "Origin": LEETCODE_BASE_URL,
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json, text/html, */*",
            "Accept-Language": "en-US,en;q=0.9",
        }

    def _parse_acceptance_rate(self, value: Any) -> float | None:
        if value in (None, ""):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            normalized = value.strip().replace("%", "")
            try:
                return float(normalized)
            except ValueError:
                return None
        return None


class AIService:
    def generate_assistant_response(self, payload: dict[str, Any]) -> dict[str, Any]:
        mode = payload.get("mode")
        if not mode:
            raise ValueError("Mode is required.")

        local_fallback = self._fallback_for_mode(payload)

        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            if local_fallback:
                return {
                    "answer": local_fallback,
                    "suggestedNextStep": self._suggest_next_step(mode)
                }
            raise ValueError("Missing GROQ_API_KEY. Add it to your root .env or apps/server/.env file.")

        if mode == "complexity":
            return {
                "answer": self._generate_complexity_fallback(payload.get("problem") or {}, (payload.get("userCode") or "").strip()),
                "suggestedNextStep": self._suggest_next_step(mode)
            }

        try:
            answer = self._request_groq(payload, api_key)
        except ValueError as error:
            if local_fallback:
                return {
                    "answer": local_fallback,
                    "suggestedNextStep": self._suggest_next_step(mode)
                }
            raise error

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

    def _hint_shape_is_valid(self, answer: str, hint_level: int) -> bool:
        normalized = answer.lower()
        if hint_level == 1:
            return "### starting hint" in normalized and "### starter cue" in normalized and "`" in answer
        if hint_level == 2:
            return "### directional hint" in normalized and "### checkpoint" in normalized
        return (
            "### algorithm hint" in normalized
            and "### core idea" in normalized
            and "### steps" in normalized
            and len(re.findall(r"^\d+\.\s", answer, flags=re.MULTILINE)) == 4
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

    def _read_error_text(self, error: urllib.error.HTTPError) -> str:
        try:
            return error.read().decode("utf-8")
        except Exception:
            return ""

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
                    "Write 1 or 2 short sentences that tell the student the best first move for this exact problem.",
                    "### Starter cue",
                    "Write exactly 1 short line in backticks.",
                    "The starter cue may be a formula, expression, or variable setup, but it must not be full code.",
                ])
            if hint_level == 2:
                return "\n".join([
                    "Use this exact section order:",
                    "### Directional hint",
                    "Write 2 to 4 short sentences that describe the approach flow and the key decisions.",
                    "### Checkpoint",
                    "Write 1 short sentence about the next condition, update order, or invariant the student should verify.",
                    "Do not include code.",
                ])
            return "\n".join([
                "Use this exact section order:",
                "### Algorithm hint",
                "### Core idea",
                "Write 1 or 2 short sentences naming the state, structure, or pattern that solves the problem.",
                "### Steps",
                "Then write exactly 4 numbered steps.",
                "Each step must be plain English, problem-specific, and describe the solving algorithm instead of a dry run.",
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
            return "Move to the next hint only if you still want more direction."
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

        if "hash table" in tags:
            if hint_level == 1:
                return "\n".join([
                    "### Starting hint",
                    "Do one left-to-right pass and ask, for each value, what partner would complete the answer right now.",
                    "Check for that partner before you store the current value.",
                    "",
                    "### Starter cue",
                    "`need = target - nums[i]`",
                ])
            if hint_level == 2:
                return "\n".join([
                    "### Directional hint",
                    "Keep a lookup from earlier values to their positions so each new value can ask for its partner instantly.",
                    "The flow is: compute the needed partner, check the lookup, and only store the current value if the partner is not there yet.",
                    "",
                    "### Checkpoint",
                    "Your update order matters: query first, insert second.",
                ])
            return "\n".join([
                "### Algorithm hint",
                "### Core idea",
                "Use one pass plus a lookup table so each number can immediately check whether its partner has already appeared.",
                "",
                "### Steps",
                "1. Create a lookup table for values you have already seen.",
                "2. Scan the input from left to right and compute the partner needed for the current value.",
                "3. If that partner is already in the lookup table, use the stored position and the current position to form the answer.",
                "4. Otherwise, store the current value with its position and continue.",
            ])

        if "two pointers" in tags and "linked list" in tags:
            if hint_level == 1:
                return "\n".join([
                    "### Starting hint",
                    "Work directly on the linked list instead of copying values out first.",
                    "Find the important node with moving pointers before you change any links.",
                    "",
                    "### Starter cue",
                    "`while fast and fast.next:`",
                ])
            if hint_level == 2:
                return "\n".join([
                    "### Directional hint",
                    "Move one pointer slowly and one quickly so the slow pointer lands on the node you care about at the correct time.",
                    "Keep track of the node just before `slow`, because that is the link you will update when the target is found.",
                    "",
                    "### Checkpoint",
                    "Decide the exact loop stop condition before you reconnect any pointers.",
                ])
            return "\n".join([
                "### Algorithm hint",
                "### Core idea",
                "Two pointers let you locate the target node in one traversal, and a previous pointer lets you reconnect the list cleanly.",
                "",
                "### Steps",
                "1. Initialize slow and fast pointers at the head and also keep a previous pointer for the slow pointer.",
                "2. Move slow by one step and fast by two steps until fast reaches the end condition for the target node.",
                "3. Once slow is on the node to remove, reconnect the previous node so it skips the slow node.",
                "4. Return the head of the updated linked list.",
            ])

        if "binary search" in tags:
            if hint_level == 1:
                return "\n".join([
                    "### Starting hint",
                    "First decide what the search space is: an index range or an answer range.",
                    "Then write the middle candidate you will test each round.",
                    "",
                    "### Starter cue",
                    "`mid = left + (right - left) // 2`",
                ])
            if hint_level == 2:
                return "\n".join([
                    "### Directional hint",
                    "Each round should test the middle candidate and use the result to discard one half safely.",
                    "The real decision is not the mid formula; it is the condition that proves the answer must lie on one side.",
                    "",
                    "### Checkpoint",
                    "Make sure every branch shrinks the search range, otherwise the loop can stall.",
                ])
            return "\n".join([
                "### Algorithm hint",
                "### Core idea",
                "Binary search works because one test on the middle candidate tells you which half of the remaining search space is still valid.",
                "",
                "### Steps",
                "1. Set the low and high boundaries of the valid search space.",
                "2. Repeatedly compute the middle candidate.",
                "3. Evaluate the middle candidate and use the result to discard one half of the search space.",
                "4. Continue until the stopping condition gives you the final answer.",
            ])

        if "dynamic programming" in tags:
            if hint_level == 1:
                return "\n".join([
                    "### Starting hint",
                    "Start by defining one smaller subproblem whose answer helps build the full answer.",
                    "Ask what result you want `dp[i]` to mean before you think about transitions.",
                    "",
                    "### Starter cue",
                    "`dp[i] = best answer for the first i positions/items`",
                ])
            if hint_level == 2:
                return "\n".join([
                    "### Directional hint",
                    "Write the DP state first, then list which earlier states are allowed to transition into it.",
                    "After that, pick a fill order where those earlier states are already solved when you need them.",
                    "",
                    "### Checkpoint",
                    "If you cannot explain the meaning of one DP cell in one sentence, the state is still too vague.",
                ])
            return "\n".join([
                "### Algorithm hint",
                "### Core idea",
                "DP solves the problem by storing answers for smaller states and reusing them instead of recomputing the same work.",
                "",
                "### Steps",
                "1. Define the DP state so each entry has one clear meaning.",
                "2. Write the transition using only earlier states that are already known.",
                "3. Fill the states in dependency order from smallest to largest.",
                "4. Return the state that represents the full problem answer.",
            ])

        if "graph" in tags or "breadth-first search" in tags or "depth-first search" in tags:
            if hint_level == 1:
                return "\n".join([
                    "### Starting hint",
                    f"Treat {title} as a state exploration problem and decide what one node or one state actually represents.",
                    "Once the state is clear, the traversal choice becomes much easier.",
                    "",
                    "### Starter cue",
                    "`visited.add(state)`",
                ])
            if hint_level == 2:
                return "\n".join([
                    "### Directional hint",
                    "Build the neighbor relation first, then traverse while marking visited states early so work is not repeated.",
                    "Use BFS when shortest distance or minimum steps matter, and DFS when full exploration is enough.",
                    "",
                    "### Checkpoint",
                    "Choose exactly when a state becomes visited: on push/enqueue or on pop/dequeue, then stay consistent.",
                ])
            return "\n".join([
                "### Algorithm hint",
                "### Core idea",
                "Model the valid positions or conditions as states and traverse them once while preventing revisits.",
                "",
                "### Steps",
                "1. Model the valid positions or conditions as graph states.",
                "2. Build or generate the neighbors reachable from each state.",
                "3. Traverse the states while marking visited ones so each state is processed once.",
                "4. Return the answer collected from the traversal result that matches the problem goal.",
            ])

        if "math" in tags or "geometry" in tags or "simulation" in tags:
            if "clock" in statement and "angle" in statement:
                if hint_level == 1:
                    return "\n".join([
                        "### Starting hint",
                        "Convert the clock into two separate angle formulas before you think about the final comparison.",
                        "The hour hand is the subtle part because it keeps moving while the minutes pass.",
                        "",
                        "### Starter cue",
                        "`minute_angle = 6 * minutes`, `hour_angle = 30 * (hour % 12) + 0.5 * minutes`",
                    ])
                if hint_level == 2:
                    return "\n".join([
                        "### Directional hint",
                        "Compute the minute-hand angle and the hour-hand angle separately, then compare them with an absolute difference.",
                        "Because the clock is circular, the final answer is the smaller of the direct gap and the wraparound gap.",
                        "",
                        "### Checkpoint",
                        "Do not forget that `12` behaves like `0` on the clock face.",
                    ])
                return "\n".join([
                    "### Algorithm hint",
                    "### Core idea",
                    "Turn the problem into two angle computations, then take the smaller circular distance between them.",
                    "",
                    "### Steps",
                    "1. Convert the minute value into the minute-hand angle using how many degrees it moves per minute.",
                    "2. Convert the hour and minute values into the hour-hand angle, including the extra movement caused by the minutes.",
                    "3. Compute the absolute difference between the two angles.",
                    "4. Return the smaller value between that difference and the full-circle complement.",
                ])

            if hint_level == 1:
                return "\n".join([
                    "### Starting hint",
                    "Write the direct quantity you can compute first instead of trying to reason about the full answer verbally.",
                    "Math and simulation problems usually become easier once each piece has its own formula or update rule.",
                    "",
                    "### Starter cue",
                    "`value_after_step = previous_value + current_contribution`",
                ])
            if hint_level == 2:
                return "\n".join([
                    "### Directional hint",
                    "Break the problem into the few quantities that change, compute each one separately, and combine them only at the end.",
                    "If the answer wraps around, repeats, or depends on units, handle that adjustment after the main calculation.",
                    "",
                    "### Checkpoint",
                    "Make sure every formula uses the correct unit and rate of change.",
                ])
            return "\n".join([
                "### Algorithm hint",
                "### Core idea",
                "Compute the core quantities directly from the input, then apply the final comparison or adjustment the statement requires.",
                "",
                "### Steps",
                "1. Identify the exact values or measurements that can be computed directly from the input.",
                "2. Write the formula or update rule for each value separately.",
                "3. Combine those computed values to produce the raw answer.",
                "4. Apply any final minimization, wraparound, or formatting rule from the statement before returning the result.",
            ])

        if hint_level == 1:
            starting_line = f"Start by restating what one step of progress looks like in {title}."
            if example:
                starting_line += f" Use the first sample as your guide: {example}"
            return "\n".join([
                "### Starting hint",
                f"{starting_line} Ask what information you need to keep after each step so the next step becomes easier.",
                "",
                "### Starter cue",
                "`track_the_state_you_wish_you_knew_before_the_next_step`",
            ])
        if hint_level == 2:
            return "\n".join([
                "### Directional hint",
                "Focus on the repeated decision in the problem and decide what should be tracked before moving forward.",
                "Once that tracked state is clear, the rest of the flow usually becomes one pass or one ordered traversal.",
                "",
                "### Checkpoint",
                "You should be able to say what changes after every step and why that change helps the next step.",
            ])
        return "\n".join([
            "### Algorithm hint",
            "### Core idea",
            "Identify the minimum state or helper structure that removes repeated work, then process the input in the order that keeps that state useful.",
            "",
            "### Steps",
            "1. Identify the exact state or helper structure you need to maintain.",
            "2. Process the input in the order that keeps previously computed information useful.",
            "3. Update that state after each step according to the current element or condition.",
            "4. Return the final value once the full traversal or construction is complete.",
        ])

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

    def _one_line_idea(self, tags: list[str]) -> str:
        lowered = [tag.lower() for tag in tags]
        if "hash table" in lowered:
            return "Use fast lookup so you do not recheck old work."
        if "two pointers" in lowered:
            return "Move pointers with purpose instead of restarting scans."
        if "dynamic programming" in lowered:
            return "Build the answer from smaller solved states."
        if "binary search" in lowered:
            return "Search the answer space by testing a middle candidate."
        if "graph" in lowered or "breadth-first search" in lowered or "depth-first search" in lowered:
            return "Explore states systematically and avoid revisiting them."
        return "Find the repeated question in brute force, then answer that question faster."

    def _max_tokens_for_mode(self, mode: str) -> int:
        if mode == "hint":
            return 240
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
        language = payload.get("language") or "C++"

        if mode == "complexity":
            return self._generate_complexity_fallback(problem, code)
        if mode == "debug":
            return self._generate_debug_fallback(problem, code, language)
        if mode == "optimize":
            return self._generate_optimize_fallback(problem, code)
        if mode == "full_solution":
            return self._generate_full_solution_fallback(problem, language)
        if mode == "dry_run":
            return self._generate_dry_run_fallback(problem)
        return None

    def _generate_complexity_fallback(self, problem: dict[str, Any], code: str) -> str:
        best_time, best_space, best_reason, worst_time, worst_space, worst_reason = self._infer_problem_complexity(problem)

        sections = [
            "### Best for this question",
            f"- Time: {best_time}",
            f"- Space: {best_space}",
            f"- Why: {best_reason}",
            "",
            "### Worst for this question",
            f"- Time: {worst_time}",
            f"- Space: {worst_space}",
            f"- Why: {worst_reason}",
        ]

        if code:
            code_time, code_space, code_reason = self._infer_code_complexity(code, problem)
            sections.extend([
                "",
                "### Your code",
                f"- Time: {code_time}",
                f"- Space: {code_space}",
                f"- Why: {code_reason}",
            ])

        return "\n".join(sections)

    def _infer_problem_complexity(self, problem: dict[str, Any]) -> tuple[str, str, str, str, str, str]:
        tags = {tag.lower() for tag in problem.get("tags", [])}
        text = f"{problem.get('title', '')} {problem.get('statement', '')}".lower()

        if "clock" in text and "angle" in text:
            return (
                r"\( O(1) \)",
                r"\( O(1) \)",
                "You can compute both angles directly from the hour and minute values with formulas.",
                r"\( O(720) \)",
                r"\( O(1) \)",
                "A brute-force idea could simulate each minute position across a full clock cycle before comparing angles.",
            )

        if "binary search" in tags:
            return (
                r"\( O(\log n) \)",
                r"\( O(1) \)",
                "The target is to discard half of the remaining search space each step.",
                r"\( O(n) \)",
                r"\( O(1) \)",
                "A basic fallback is to scan linearly until the answer is found.",
            )

        if "hash table" in tags:
            return (
                r"\( O(n) \)",
                r"\( O(n) \)",
                "One pass with constant-time lookup is usually the accepted target for this pattern.",
                r"\( O(n^2) \)",
                r"\( O(1) \)",
                "The brute-force version usually checks many pairs or repeatedly rescans earlier values.",
            )

        if "two pointers" in tags:
            if "sorted" in text or "non-decreasing" in text or "nondecreasing" in text:
                return (
                    r"\( O(n) \)",
                    r"\( O(1) \)",
                    "Once the order is usable, two pointers usually solve it in one sweep.",
                    r"\( O(n^2) \)",
                    r"\( O(1) \)",
                    "The naive version usually tries many pairs or ranges separately.",
                )
            return (
                r"\( O(n \log n) \)",
                r"\( O(1) \)",
                "If sorting is needed first, the common target is sort plus one pointer sweep.",
                r"\( O(n^2) \)",
                r"\( O(1) \)",
                "The brute-force version usually compares many candidate pairs directly.",
            )

        if "dynamic programming" in tags:
            if any(token in text for token in ("grid", "matrix", "rows", "columns")):
                return (
                    r"\( O(mn) \)",
                    r"\( O(mn) \) or \( O(n) \)",
                    "Grid DP usually visits each state once, with optional space compression.",
                    r"\( O(2^{m+n}) \) to \( O(4^{mn}) \)",
                    r"\( O(m+n) \) or more",
                    "A naive recursive search can explode because it recomputes many overlapping states.",
                )
            return (
                r"\( O(n) \) to \( O(n^2) \)",
                r"\( O(n) \) or less",
                "The accepted approach normally computes each state once and reuses it.",
                r"\( O(2^n) \)",
                r"\( O(n) \)",
                "The brute-force recursive version often repeats the same subproblems exponentially many times.",
            )

        if "graph" in tags or "breadth-first search" in tags or "depth-first search" in tags:
            return (
                r"\( O(V + E) \)",
                r"\( O(V) \)",
                "The target is to process each vertex and edge only once.",
                r"\( O(V \cdot (V + E)) \)",
                r"\( O(V) \)",
                "A bad approach can restart traversals from too many states and repeat work heavily.",
            )

        if "tree" in tags or "binary tree" in tags or "binary search tree" in tags:
            return (
                r"\( O(n) \)",
                r"\( O(h) \)",
                "A clean traversal usually visits each node once, with recursion stack or explicit stack height \( h \).",
                r"\( O(n^2) \)",
                r"\( O(h) \)",
                "Repeated subtree recomputation can turn tree problems quadratic.",
            )

        if "math" in tags or "simulation" in tags:
            return (
                r"\( O(1) \)",
                r"\( O(1) \)",
                "Math or direct-simulation problems often reduce to a formula or a fixed number of operations.",
                r"\( O(n) \)",
                r"\( O(1) \)",
                "The slower version usually simulates step by step instead of using the direct relationship.",
            )

        if "sliding window" in tags or "string" in tags or "array" in tags:
            return (
                r"\( O(n) \)",
                r"\( O(1) \) to \( O(n) \)",
                "The standard target is usually one pass with a small amount of tracked state.",
                r"\( O(n^2) \)",
                r"\( O(1) \)",
                "The brute-force version often checks every subarray, substring, or pair separately.",
            )

        return (
            r"\( O(n) \) to \( O(n \log n) \)",
            r"\( O(1) \) to \( O(n) \)",
            "Most accepted approaches avoid repeated rescans and keep the main work close to one pass or one sort.",
            r"\( O(n^2) \)",
            r"\( O(1) \) to \( O(n) \)",
            "The slower version usually repeats work across many pairs, ranges, or states.",
        )

    def _infer_code_complexity(self, code: str, problem: dict[str, Any]) -> tuple[str, str, str]:
        lowered = code.lower()
        tags = {tag.lower() for tag in problem.get("tags", [])}

        uses_sort = any(token in lowered for token in ("sort(", ".sort(", "sorted("))
        uses_hash = any(token in lowered for token in ("unordered_map", "unordered_set", "hashmap", "hashset", "dict(", "set("))
        uses_queue = any(token in lowered for token in ("queue<", "deque<", "queue(", "deque(", "linkedlist<"))
        uses_stack = any(token in lowered for token in ("stack<", "stack(", ".append(", ".pop("))
        uses_recursion = self._looks_recursive(lowered)
        nested_loops = self._has_nested_loops(code)
        loop_count = len(re.findall(r"\bfor\b|\bwhile\b", lowered))
        binary_search_shape = "mid" in lowered and any(token in lowered for token in ("left", "right", "low", "high"))

        if "graph" in tags or uses_queue:
            return (
                r"\( O(V + E) \)",
                r"\( O(V) \)",
                "This looks like traversal-style code where each state is processed through a visited structure or queue once.",
            )

        if binary_search_shape:
            return (
                r"\( O(\log n) \)",
                r"\( O(1) \)",
                "The code shape suggests binary search because it keeps bounds and a middle index.",
            )

        if nested_loops:
            space = r"\( O(n) \)" if (uses_hash or uses_stack or uses_queue) else r"\( O(1) \)"
            reason = "There are nested loop patterns, so the main work grows roughly with pairwise comparisons."
            if uses_hash:
                reason += " Extra storage is also used for lookup state."
            return (r"\( O(n^2) \)", space, reason)

        if uses_sort:
            space = r"\( O(n) \)" if (uses_hash or uses_stack or uses_queue) else r"\( O(1) \) to \( O(n) \)"
            return (
                r"\( O(n \log n) \)",
                space,
                "The dominant step appears to be sorting, then processing the result with simpler scans.",
            )

        if loop_count >= 1 and uses_hash:
            return (
                r"\( O(n) \)",
                r"\( O(n) \)",
                "The code looks like a one-pass scan with hash-based lookup or storage.",
            )

        if loop_count >= 1:
            space = r"\( O(n) \)" if (uses_stack or uses_queue or uses_recursion) else r"\( O(1) \)"
            reason = "The code mainly looks like a single pass over the data."
            if uses_recursion:
                reason += " Recursion or an explicit stack adds extra call/state storage."
            return (r"\( O(n) \)", space, reason)

        if uses_recursion:
            return (
                r"\( O(n) \)",
                r"\( O(n) \)",
                "The work looks recursive without a heavy loop body, so the main extra cost is the call stack.",
            )

        return (
            r"\( O(1) \)",
            r"\( O(1) \)",
            "The code looks formula-based or fixed-work rather than input-length driven.",
        )

    def _has_nested_loops(self, code: str) -> bool:
        c_style = re.search(r"\b(for|while)\b[\s\S]{0,220}\{[\s\S]{0,220}\b(for|while)\b", code)
        python_style = re.search(r"(?m)^\s*(for|while)\b[\s\S]{0,220}\n[ \t]{2,}(for|while)\b", code)
        return bool(c_style or python_style)

    def _looks_recursive(self, lowered_code: str) -> bool:
        function_names = re.findall(r"\b(?:def|function|int|long long|double|bool|void|string|list|vector<[^>]+>|public|private|static)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", lowered_code)
        for name in function_names:
            if lowered_code.count(f"{name}(") >= 2:
                return True
        return False

    def _generate_debug_fallback(self, problem: dict[str, Any], code: str, language: str) -> str:
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

    def _generate_optimize_fallback(self, problem: dict[str, Any], code: str) -> str:
        tags = [tag.lower() for tag in problem.get("tags", [])]
        if "hash table" in tags:
            suggestion = "Move from repeated pair checks to one pass plus fast lookup."
            target = r"Target: improve from \( O(n^2) \) to \( O(n) \) time with \( O(n) \) extra space."
        elif "two pointers" in tags:
            suggestion = "Sort if needed, then let two pointers close in instead of restarting scans."
            target = r"Target: keep it near \( O(n) \) after preprocessing, often with \( O(1) \) extra space."
        elif "dynamic programming" in tags:
            suggestion = "Define one DP state, reuse solved subproblems, then compress memory if only the last states matter."
            target = r"Target: remove repeated recomputation and keep only the states you still need."
        elif "binary search" in tags:
            suggestion = "Replace linear checking across the whole search range with a yes or no feasibility test and halve the space each step."
            target = r"Target: move toward \( O(\log n) \) decisions over a sorted range or answer space."
        elif "graph" in tags or "breadth-first search" in tags or "depth-first search" in tags:
            suggestion = "Build adjacency once, mark visited early, and make sure each state is explored only once."
            target = r"Target: reach \( O(V + E) \) by preventing repeated traversal."
        else:
            suggestion = "Look for repeated work and replace it with a structure that answers the repeated question faster."
            target = r"Target: reduce repeated scans and keep the decision step constant or logarithmic."

        return "\n".join([
            "### Optimization path",
            suggestion,
            "",
            "### What to improve",
            "- Reduce repeated scans of the same data.",
            "- Store the exact information you need for the next decision.",
            "- Keep the solution in one clear pass if the pattern allows it.",
            "",
            "### Target complexity",
            target,
        ])

    def _generate_full_solution_fallback(self, problem: dict[str, Any], language: str) -> str:
        tags = [tag.lower() for tag in problem.get("tags", [])]
        title = problem.get("title", "Problem")

        if "hash table" in tags:
            idea = "Scan once and remember earlier values in a hash map."
            time = r"\( O(n) \)"
            space = r"\( O(n) \)"
            code = self._hash_table_solution(language)
        elif "binary search" in tags:
            idea = "Use the sorted structure or answer range to discard half the search space each step."
            time = r"\( O(\log n) \)"
            space = r"\( O(1) \)"
            code = self._binary_search_solution(language)
        elif "dynamic programming" in tags:
            idea = "Build the final answer from smaller solved states instead of recomputing them."
            time = r"\( O(n) \) to \( O(n^2) \), depending on the transition."
            space = r"\( O(n) \) or better with state compression."
            code = self._dynamic_programming_template(language)
        else:
            code = self._generic_solution_template(language)
            idea = "Use the main problem pattern to reduce repeated work."
            time = r"\( O(n) \) to \( O(n \log n) \), depending on the final approach."
            space = r"\( O(1) \) to \( O(n) \)."

        return "\n".join([
            "### Solution idea",
            f"For **{title}**, the goal is to use the main pattern directly instead of brute force.",
            "",
            "### Why this works",
            idea,
            "",
            "### Code",
            code,
            "",
            "### Complexity",
            f"- Time: {time}",
            f"- Space: {space}",
        ])

    def _hash_table_solution(self, language: str) -> str:
        if language == "C++":
            return """```cpp
vector<int> twoSum(vector<int>& nums, int target) {
    unordered_map<int, int> seen;
    for (int i = 0; i < (int)nums.size(); ++i) {
        int need = target - nums[i];
        if (seen.count(need)) {
            return {seen[need], i};
        }
        seen[nums[i]] = i;
    }
    return {};
}
```"""
        if language == "Python":
            return """```python
def twoSum(nums, target):
    seen = {}
    for index, value in enumerate(nums):
        need = target - value
        if need in seen:
            return [seen[need], index]
        seen[value] = index
    return []
```"""
        if language == "Java":
            return """```java
public int[] twoSum(int[] nums, int target) {
    Map<Integer, Integer> seen = new HashMap<>();
    for (int i = 0; i < nums.length; i++) {
        int need = target - nums[i];
        if (seen.containsKey(need)) {
            return new int[] {seen.get(need), i};
        }
        seen.put(nums[i], i);
    }
    return new int[0];
}
```"""
        if language == "JavaScript":
            return """```javascript
function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i += 1) {
    const need = target - nums[i];
    if (seen.has(need)) {
      return [seen.get(need), i];
    }
    seen.set(nums[i], i);
  }
  return [];
}
```"""
        return "```text\nUse one pass plus a hash map from value to index.\n```"

    def _binary_search_solution(self, language: str) -> str:
        if language == "C++":
            return """```cpp
int search(vector<int>& nums, int target) {
    int left = 0;
    int right = (int)nums.size() - 1;
    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (nums[mid] == target) return mid;
        if (nums[mid] < target) left = mid + 1;
        else right = mid - 1;
    }
    return -1;
}
```"""
        if language == "Python":
            return """```python
def search(nums, target):
    left, right = 0, len(nums) - 1
    while left <= right:
        mid = left + (right - left) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1
```"""
        if language == "Java":
            return """```java
public int search(int[] nums, int target) {
    int left = 0;
    int right = nums.length - 1;
    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (nums[mid] == target) return mid;
        if (nums[mid] < target) left = mid + 1;
        else right = mid - 1;
    }
    return -1;
}
```"""
        if language == "JavaScript":
            return """```javascript
function search(nums, target) {
  let left = 0;
  let right = nums.length - 1;
  while (left <= right) {
    const mid = left + Math.floor((right - left) / 2);
    if (nums[mid] === target) return mid;
    if (nums[mid] < target) left = mid + 1;
    else right = mid - 1;
  }
  return -1;
}
```"""
        return "```text\nKeep left and right bounds, test the middle, and shrink the valid half each step.\n```"

    def _dynamic_programming_template(self, language: str) -> str:
        if language == "C++":
            return """```cpp
int solve(vector<int>& nums) {
    vector<int> dp(nums.size() + 1, 0);
    for (int i = 1; i <= (int)nums.size(); ++i) {
        dp[i] = max(dp[i - 1], dp[max(0, i - 2)] + nums[i - 1]);
    }
    return dp[nums.size()];
}
```"""
        if language == "Python":
            return """```python
def solve(nums):
    prev2 = 0
    prev1 = 0
    for value in nums:
        current = max(prev1, prev2 + value)
        prev2, prev1 = prev1, current
    return prev1
```"""
        if language == "Java":
            return """```java
public int solve(int[] nums) {
    int prev2 = 0;
    int prev1 = 0;
    for (int value : nums) {
        int current = Math.max(prev1, prev2 + value);
        prev2 = prev1;
        prev1 = current;
    }
    return prev1;
}
```"""
        if language == "JavaScript":
            return """```javascript
function solve(nums) {
  let prev2 = 0;
  let prev1 = 0;
  for (const value of nums) {
    const current = Math.max(prev1, prev2 + value);
    prev2 = prev1;
    prev1 = current;
  }
  return prev1;
}
```"""
        return "```text\nDefine one DP state, transition from earlier states, and compress memory when possible.\n```"

    def _generic_solution_template(self, language: str) -> str:
        language_label = language.lower()
        if language_label == "c++":
            return """```cpp
// Outline:
// 1. Identify the core state or data structure.
// 2. Scan the input once or in dependency order.
// 3. Update the state before moving to the next item.
// 4. Return the final computed answer.
```"""
        if language_label == "python":
            return """```python
# Outline:
# 1. Decide what state to track.
# 2. Process each item in the required order.
# 3. Update the state carefully.
# 4. Return the computed result.
```"""
        if language_label == "java":
            return """```java
// Outline:
// 1. Decide what state to track.
// 2. Process each item in the required order.
// 3. Update the state carefully.
// 4. Return the computed result.
```"""
        if language_label == "javascript":
            return """```javascript
// Outline:
// 1. Decide what state to track.
// 2. Process each item in the required order.
// 3. Update the state carefully.
// 4. Return the computed result.
```"""
        return "```text\nTrack the minimum state needed, process the input in the correct order, and return the final state.\n```"

    def _generate_dry_run_fallback(self, problem: dict[str, Any]) -> str:
        example = self._extract_example_text(problem)
        strategy = self._one_line_idea(problem.get("tags") or [])
        return "\n".join([
            "### Dry run",
            example or "Take the first sample input and track how the main state changes step by step.",
            "",
            "### Walkthrough",
            f"1. Start with the initial state suggested by the pattern: {strategy}",
            "2. Process the first meaningful element or state transition.",
            "3. Update the helper structure, pointer, or DP state.",
            "4. Repeat until the stopping condition is reached.",
            "5. Return the answer stored by the final state.",
            "",
            "### What to track",
            "- current index or pointer position",
            "- helper data structure contents",
            "- condition that decides the final answer",
        ])

    def _extract_example_text(self, problem: dict[str, Any]) -> str:
        examples = problem.get("examples") or []
        if not examples:
            return ""
        example = re.sub(r"\s+", " ", examples[0]).strip()
        return example[:240].rsplit(" ", 1)[0] + "..." if len(example) > 240 else example


leetcode_service = LeetCodeService()
ai_service = AIService()
