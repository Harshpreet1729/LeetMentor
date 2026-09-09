"""Fetch LeetCode problems and turn their HTML into dashboard data."""

import json
import os
import re
from urllib.parse import urlparse
from dataclasses import dataclass
from html import unescape
from typing import Any

import requests


DEFAULT_GRAPHQL_URL = "https://leetcode.com/graphql"


ALL_PROBLEMS_ENDPOINT = "https://leetcode.com/api/problems/all/"


LEETCODE_BASE_URL = "https://leetcode.com"


DAILY_QUERY = """
query questionOfToday {
  activeDailyCodingChallengeQuestion {
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
    """Resolve a number, title, slug, or URL; reuse fetched problems in memory."""

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
            parsed = urlparse(identifier)
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

        try:
            response = requests.get(
                ALL_PROBLEMS_ENDPOINT,
                headers=self._default_headers(f"{LEETCODE_BASE_URL}/problemset/"),
                timeout=20,
            )
            response.raise_for_status()
            data = response.json()
        except requests.RequestException:
            self.problem_index_cache = []
            return self.problem_index_cache
        except ValueError:
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
        try:
            response = requests.post(
                url,
                json={"query": query, "variables": variables},
                headers={
                    **self._default_headers(LEETCODE_BASE_URL),
                    "Content-Type": "application/json",
                },
                timeout=30,
            )
        except requests.RequestException as error:
            raise ValueError("Could not reach LeetCode. Check your internet connection and try again.") from error

        if response.status_code >= 400:
            raise ValueError(f"LeetCode request failed with status {response.status_code}.")

        try:
            payload = response.json()
        except ValueError as error:
            raise ValueError("LeetCode returned an invalid response.") from error

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


leetcode_service = LeetCodeService()
