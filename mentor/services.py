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
If the student asks for full code, provide clean accepted code with explanation, dry run, edge cases, and time and space complexity.
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
- If you mention complexity, formulas, recurrence relations, or numeric expressions, write them in LaTeX using `\\( ... \\)` or `\\[ ... \\]`.
- Never leave formulas in plain text if LaTeX would make them clearer.
- Any code must be inside fenced code blocks with the language tag.
- When referring to a specific expression, variable, or code line, wrap it in backticks.
- Prefer compact answers over long essays.
- Do not shame the student.
- Do not overcomplicate beginner explanations.
- For hint mode, stay short and directional.
- For hint mode, never include full code.
- For hint mode, return exactly 2 short lines:
Direction: ...
Think next: ...
- For hint mode, keep the whole answer under 60 words unless the student explicitly asks for more detail."""

MODE_GUIDANCE = {
    "hint": "Give a progressive hint only. Respect hint level. Keep it short, actionable, and under 90 words. Do not use full code.",
    "explain": "Explain the problem briefly. Include the goal, one small example, and the core idea. Use LaTeX if a formula appears.",
    "debug": "Review the student's actual code. Identify the exact bug, explain why it fails on one concrete case, and show the corrected version in a fenced code block only if needed.",
    "complexity": "State the current time and space complexity precisely using LaTeX, then say whether a better approach exists and what its complexity would be.",
    "dry_run": "Give a short step-by-step dry run on one example only. Keep state transitions clear.",
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
        statement, examples, constraints = self._extract_sections(question.get("content") or "")
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
            acceptance_rate=self._parse_acceptance_rate(stats.get("acRate")),
        )

    def _extract_sections(self, content: str) -> tuple[str, list[str], list[str]]:
        plain_text = re.sub(r"\n{2,}", "\n\n", self._html_to_text(content)).strip()
        parts = re.split(r"Example \d+:", plain_text, flags=re.IGNORECASE)
        statement = parts[0].strip() if parts else plain_text
        examples = [match.strip() for match in re.findall(r"Example\s+\d+:\s*([\s\S]*?)(?=Example\s+\d+:|Constraints:|$)", plain_text, flags=re.IGNORECASE)]

        constraints: list[str] = []
        match = re.search(r"Constraints:\s*([\s\S]*)$", plain_text, flags=re.IGNORECASE)
        if match:
            constraints = []
            for raw_line in match.group(1).splitlines():
                line = raw_line.strip()
                if not line:
                    continue
                if line.startswith("-"):
                    line = line[1:].strip()
                constraints.append(line)

        return statement, examples, constraints

    def _html_to_text(self, content: str) -> str:
        text = content.replace("<pre>", "\n").replace("</pre>", "\n").replace("<li>", "- ").replace("</li>", "\n")
        text = re.sub(r"<[^>]+>", " ", text)
        text = unescape(text)
        text = re.sub(r"\s+\n", "\n", text)
        return text

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

        if mode == "hint":
            local_hint = self._generate_progressive_hint(payload.get("problem"), int(payload.get("hintLevel") or 1))
            if local_hint:
                return {
                    "answer": local_hint,
                    "suggestedNextStep": "Ask for the next hint level only if you still feel stuck.",
                }

        if mode == "explain":
            local_explanation = self._generate_concise_explanation(payload.get("problem"))
            if local_explanation:
                return {
                    "answer": local_explanation,
                    "suggestedNextStep": "Ask for a hint if you want help choosing the approach."
                }

        local_fallback = self._fallback_for_mode(payload)

        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            if local_fallback:
                return {
                    "answer": local_fallback,
                    "suggestedNextStep": self._suggest_next_step(mode)
                }
            raise ValueError("Missing GROQ_API_KEY. Add it to your root .env or apps/server/.env file.")

        try:
            answer = self._request_groq(payload, api_key)
        except ValueError as error:
            if local_fallback:
                return {
                    "answer": local_fallback,
                    "suggestedNextStep": self._suggest_next_step(mode)
                }
            raise error

        if mode == "hint" and len(answer) < 25:
            local_hint = self._generate_progressive_hint(payload.get("problem"), int(payload.get("hintLevel") or 1))
            if local_hint:
                answer = local_hint

        if mode == "explain" and len(answer) < 25:
            local_explanation = self._generate_concise_explanation(payload.get("problem"))
            if local_explanation:
                answer = local_explanation

        return {"answer": answer, "suggestedNextStep": self._suggest_next_step(mode)}

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
            request = urllib.request.Request(
                GROQ_CHAT_COMPLETIONS_URL,
                data=json.dumps(request_body).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=22) as response:
                    data = json.loads(response.read().decode("utf-8"))
                answer = self._extract_groq_answer(data)
                if answer:
                    return answer
                last_error = ValueError("Groq returned an empty response.")
            except urllib.error.HTTPError as error:
                details = self._read_error_text(error)
                if self._should_retry_model(error.code, details):
                    last_error = ValueError(f"Groq model `{model}` is unavailable.")
                    continue
                raise ValueError(f"Groq request failed: {error.code} {details}".strip()) from error
            except urllib.error.URLError as error:
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
        pieces = [
            f"Mode: {mode}",
            f"Mode guidance: {MODE_GUIDANCE[mode]}",
            f"Required response shape:\n{self._response_contract(mode)}",
            f"Hint level: {payload.get('hintLevel')}" if payload.get("hintLevel") else "",
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

    def _response_contract(self, mode: str) -> str:
        if mode == "hint":
            return "\n".join([
                "Return exactly 2 lines.",
                "Line 1: Direction: ...",
                "Line 2: Think next: ...",
            ])
        if mode == "debug":
            return "\n".join([
                "Use this exact section order when relevant:",
                "### Issue",
                "### Why it breaks",
                "### Fix",
                "### Corrected code",
                "Keep the answer focused on the student's code, not generic advice.",
            ])
        if mode == "complexity":
            return "\n".join([
                "Use this exact section order:",
                "### Complexity",
                "### Better approach",
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
                "Return exactly one fenced code block.",
            ])
        if mode == "dry_run":
            return "\n".join([
                "Use this exact section order:",
                "### Example",
                "### Dry run",
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
            return "Compare the brute force and optimized approaches on a small input."
        return "Ask for a dry run, hint, or code review if you want to go deeper."

    def _generate_progressive_hint(self, problem: dict[str, Any] | None, hint_level: int) -> str | None:
        if not problem:
            return None

        tags = [tag.lower() for tag in problem.get("tags", [])]
        title = problem.get("title", "this problem")

        if "hash table" in tags:
            if hint_level == 1:
                return "### Directional hint\nAvoid checking every pair. Think about a way to know missing values faster while scanning once."
            if hint_level == 2:
                return "### Hint for the approach\nUse a hash table to remember values you have already seen, then ask what partner value is needed."
            return "### Hint from resolution\nWalk through the array once. For each number, compute the needed value, check if it is already stored, otherwise store the current number."

        if "two pointers" in tags and "linked list" in tags:
            if hint_level == 1:
                return "### Directional hint\nStay inside the linked list. You do not need an extra array to find the answer."
            if hint_level == 2:
                return "### Hint for the approach\nUse slow and fast pointers to find the middle, and keep track of the node before slow."
            return "### Hint from resolution\nMove slow by one and fast by two. When fast finishes, delete the node at slow by reconnecting the previous node."

        if "binary search" in tags:
            if hint_level == 1:
                return "### Directional hint\nThink in terms of an answer range and a yes or no check."
            if hint_level == 2:
                return "### Hint for the approach\nUse binary search on the possible answer, and test whether a candidate value is feasible."
            return "### Hint from resolution\nKeep low and high bounds, test the middle value, and discard the half that cannot contain a valid answer."

        if "dynamic programming" in tags:
            if hint_level == 1:
                return "### Directional hint\nTry to solve a smaller version first, then build the larger answer from it."
            if hint_level == 2:
                return "### Hint for the approach\nDefine one DP state clearly, then describe how it transitions from earlier states."
            return "### Hint from resolution\nFill the DP table in dependency order so each new state is computed from already solved states."

        if "graph" in tags or "breadth-first search" in tags or "depth-first search" in tags:
            if hint_level == 1:
                return f"### Directional hint\nTreat {title} like a state-exploration problem, not just a raw array question."
            if hint_level == 2:
                return "### Hint for the approach\nModel each position or condition as a node, then explore neighbors while marking visited states."
            return "### Hint from resolution\nPick BFS if you want the shortest number of moves, or DFS if you only need to explore all reachable states."

        if hint_level == 1:
            return "### Directional hint\nLook for the one observation that removes repeated work."
        if hint_level == 2:
            return "### Hint for the approach\nChoose a data structure that lets you answer the key repeated question faster."
        return "### Hint from resolution\nWrite the steps in plain English first: what to track, when to update it, and when to return the answer."

    def _generate_concise_explanation(self, problem: dict[str, Any] | None) -> str | None:
        if not problem:
            return None

        title = problem.get("title", "this problem")
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

        key_idea = self._one_line_idea(problem.get("tags") or [])

        lines = [
            "### Problem",
            title,
            "",
            "### Goal",
            statement or "Understand the input and return the required answer.",
        ]
        if example:
            lines.extend(["", "### Example", example])
        lines.extend(["", "### Core idea", key_idea])
        return "\n".join(lines)

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
            return 140
        if mode == "explain":
            return 260
        if mode in {"complexity", "dry_run"}:
            return 420
        if mode in {"debug", "optimize"}:
            return 700
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
        tags = [tag.lower() for tag in problem.get("tags", [])]
        has_nested_loops = code.count("for") + code.count("while") >= 2
        uses_sort = "sort(" in code or ".sort(" in code or "sorted(" in code
        uses_hash = any(token in code for token in ("unordered_map", "unordered_set", "HashMap", "HashSet", "dict(", "set("))
        uses_queue = any(token in code for token in ("queue<", "deque<", "queue(", "deque(", "LinkedList<"))
        if "hash table" in tags or uses_hash:
            time = r"\( O(n) \)"
            space = r"\( O(n) \)"
            better = "This is already the standard optimized approach for this pattern."
        elif "two pointers" in tags:
            time = r"\( O(n) \)"
            space = r"\( O(1) \)"
            better = "This is usually close to optimal because it avoids extra scans or extra storage."
        elif "binary search" in tags:
            time = r"\( O(\log n) \)"
            space = r"\( O(1) \)"
            better = "This is the expected target when the search space can be halved each step."
        elif "dynamic programming" in tags:
            time = r"\( O(n) \) to \( O(n^2) \), depending on the state transition."
            space = r"\( O(n) \) unless the state can be compressed."
            better = "The main improvement is usually state compression or removing repeated transitions."
        elif "graph" in tags or "breadth-first search" in tags or "depth-first search" in tags or uses_queue:
            time = r"\( O(V + E) \)"
            space = r"\( O(V) \)"
            better = "That is the usual target because each node and edge should be processed only once."
        elif has_nested_loops:
            time = r"\( O(n^2) \) in the current form."
            space = r"\( O(1) \) to \( O(n) \), depending on helper storage."
            better = "The biggest win is likely replacing the repeated inner scan with a lookup structure."
        elif uses_sort:
            time = r"\( O(n \log n) \)"
            space = r"\( O(1) \) to \( O(n) \), depending on the language and sort implementation."
            better = "Sorting is often fine, but check whether one-pass lookup can reduce it to linear time."
        else:
            time = r"\( O(n) \) to \( O(n \log n) \), depending on the exact operations in the code."
            space = r"\( O(1) \) to \( O(n) \), depending on the helper storage used."
            better = "The next improvement usually comes from reducing repeated work with a better data structure."

        return "\n".join([
            "### Complexity summary",
            f"- Time: {time}",
            f"- Space: {space}",
            "",
            "### Why",
            "The complexity depends on how many times you scan the input and whether you store extra data for fast lookup.",
            "",
            "### Optimization note",
            better,
        ])

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
