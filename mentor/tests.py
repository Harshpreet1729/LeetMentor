import json
from unittest.mock import Mock, patch

import requests
from django.contrib.staticfiles import finders
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import Client, SimpleTestCase, TestCase, TransactionTestCase

from . import views
from .leetcode import LeetCodeService
from .models import SavedSolution
from .services import AIService, ProviderError


PROBLEM = {
    "title": "Two Sum", "titleSlug": "two-sum", "questionFrontendId": "1",
    "difficulty": "Easy", "statement": "Return indices of two numbers adding to target.",
    "examples": ["[2, 7], target = 9 -> [0, 1]"], "constraints": ["At least two numbers."],
}


class LeetCodeServiceTests(SimpleTestCase):
    def setUp(self) -> None:
        self.service = LeetCodeService()

    def test_resolves_standard_leetcode_url(self) -> None:
        self.assertEqual(
            self.service._find_slug("https://leetcode.com/problems/two-sum/description/"),
            "two-sum",
        )

    def test_rejects_non_leetcode_url(self) -> None:
        with self.assertRaisesMessage(ValueError, "Only LeetCode"):
            self.service._find_slug("https://example.com/problems/two-sum/")

    def test_extracts_statement_examples_and_constraints(self) -> None:
        content = """
        <p>Return the sum.</p>
        <p><strong>Example 1:</strong></p><pre>Input: nums = [1,2]\nOutput: 3</pre>
        <p><strong>Constraints:</strong></p><ul><li>2 &lt;= nums.length</li></ul>
        """
        statement, examples, constraints, cards = self.service._extract_sections(content)
        self.assertIn("Return the sum", statement)
        self.assertTrue(examples)
        self.assertTrue(cards)
        self.assertIn("2 <= nums.length", constraints)


class AssistantTests(SimpleTestCase):
    def setUp(self):
        self.payload = {"mode": "hint", "problem": PROBLEM, "language": "Python", "userCode": "return [0, 1]"}
        self.service = AIService()

    @patch.dict("os.environ", {"GROQ_API_KEY": "test-key"})
    @patch("mentor.services.requests.post")
    def test_hint_and_review_send_problem_and_code(self, post):
        post.return_value = Mock(status_code=200, json=lambda: {"choices": [{"message": {"content": "Useful feedback"}}]})
        for mode in ("hint", "review"):
            self.payload["mode"] = mode
            self.assertEqual(self.service.get_answer(self.payload)["answer"], "Useful feedback")
            body = post.call_args.kwargs["json"]
            context = json.loads(body["messages"][1]["content"])
            self.assertEqual(context["problem"]["statement"], PROBLEM["statement"])
            self.assertEqual(context["code"], "return [0, 1]")
            self.assertIn("Do not reveal" if mode == "hint" else "Never claim", body["messages"][0]["content"])

    @patch.dict("os.environ", {"GROQ_API_KEY": "test-key"})
    @patch("mentor.services.requests.post")
    def test_hint_levels_send_distinct_guidance_and_default_to_starting(self, post):
        post.return_value = Mock(status_code=200, json=lambda: {"choices": [{"message": {"content": "Helpful hint"}}]})
        for level, label in [(1, "Starting hint"), (2, "Approach hint"), (3, "Algorithm hint")]:
            self.service.get_answer({**self.payload, "hintLevel": level})
            self.assertIn(label, post.call_args.kwargs["json"]["messages"][0]["content"])
        self.service.get_answer(self.payload)
        self.assertIn("Starting hint", post.call_args.kwargs["json"]["messages"][0]["content"])

    @patch("mentor.services.requests.post")
    def test_invalid_hint_levels_are_rejected_before_provider_call(self, post):
        for level in (0, 4, True, 1.0, "2", None, [], {}):
            with self.subTest(level=level), self.assertRaisesMessage(ValueError, "Hint level"):
                self.service.get_answer({**self.payload, "hintLevel": level})
        post.assert_not_called()

    @patch("mentor.services.requests.post")
    def test_invalid_inputs_never_call_provider(self, post):
        for change in (
            {"mode": "full_solution"}, {"mode": []}, {"language": []},
            {"mode": "review", "userCode": " "}, {"userCode": "x" * 60001},
            {"problem": None}, {"problem": {**PROBLEM, "examples": "invalid"}},
            {"problem": {**PROBLEM, "statement": ""}},
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.service.get_answer({**self.payload, **change})
        post.assert_not_called()

    @patch.dict("os.environ", {"GROQ_API_KEY": ""})
    def test_missing_key_reports_unavailable_instead_of_canned_feedback(self):
        with self.assertRaisesMessage(ValueError, "Missing GROQ_API_KEY"):
            self.service.get_answer(self.payload)

    @patch.dict("os.environ", {"GROQ_API_KEY": "test-key"})
    @patch("mentor.services.requests.post")
    def test_provider_failures_have_safe_error(self, post):
        for error in (requests.Timeout("private provider details"),):
            post.side_effect = error
            with self.assertRaisesMessage(ValueError, "Groq is unavailable"):
                self.service.get_answer(self.payload)
        post.side_effect = None
        for data in ({}, {"choices": []}, {"choices": [{"message": {"content": None}}]}):
            post.return_value = Mock(status_code=200, json=lambda: data)
            with self.assertRaisesMessage(ValueError, "Groq is unavailable"):
                self.service.get_answer(self.payload)

    @patch.dict("os.environ", {"GROQ_API_KEY": "test-key", "AI_MODEL": "llama-3.3-70b-versatile"})
    @patch("mentor.services.requests.post")
    def test_retired_host_model_falls_back_to_current_model(self, post):
        post.side_effect = [
            Mock(status_code=404, json=lambda: {"error": {"code": "model_not_found"}}),
            Mock(status_code=200, json=lambda: {"choices": [{"message": {"content": "Working hint"}}]}),
        ]
        self.assertEqual(self.service.get_answer(self.payload)["answer"], "Working hint")
        self.assertEqual(post.call_args_list[0].kwargs["json"]["model"], "llama-3.3-70b-versatile")
        self.assertEqual(post.call_args_list[1].kwargs["json"]["model"], "openai/gpt-oss-120b")
        self.assertEqual(post.call_args.kwargs["json"]["reasoning_effort"], "low")
        self.assertGreaterEqual(post.call_args.kwargs["json"]["max_completion_tokens"], 1800)

    @patch.dict("os.environ", {"GROQ_API_KEY": "test-key", "AI_MODEL": "openai/gpt-oss-120b"})
    @patch("mentor.services.requests.post")
    def test_provider_errors_are_actionable_and_not_retried(self, post):
        for status, message in [(401, "API key"), (403, "denied"), (413, "too long"), (429, "usage limit")]:
            post.reset_mock()
            post.return_value = Mock(status_code=status, json=lambda: {"error": {"code": "failure", "message": "private details"}})
            with self.subTest(status=status), self.assertRaises(ProviderError) as caught:
                self.service.get_answer(self.payload)
            self.assertIn(message, str(caught.exception))
            self.assertNotIn("private details", str(caught.exception))
            self.assertEqual(caught.exception.status, 429 if status == 429 else 502)
            self.assertEqual(post.call_count, 1)

    @patch.dict("os.environ", {"GROQ_API_KEY": "test-key", "AI_MODEL": "openai/gpt-oss-120b"})
    @patch("mentor.services.requests.post")
    def test_fallback_is_bounded_when_models_are_unavailable(self, post):
        post.return_value = Mock(status_code=404, json=lambda: {"error": {"code": "model_not_found"}})
        with self.assertRaisesMessage(ProviderError, "configured AI model"):
            self.service.get_answer(self.payload)
        self.assertEqual(post.call_count, 2)
        self.assertEqual(post.call_args.kwargs["json"]["model"], "openai/gpt-oss-20b")

    @patch.dict("os.environ", {"GROQ_API_KEY": "test-key"})
    @patch("mentor.services.requests.post")
    def test_invalid_provider_json_is_safe(self, post):
        post.return_value = Mock(status_code=200)
        post.return_value.json.side_effect = ValueError("private details")
        with self.assertRaisesMessage(ProviderError, "invalid response"):
            self.service.get_answer(self.payload)


class EndpointTests(TestCase):
    def setUp(self):
        views._assistant_request_times.clear()
        self.solution = {
            "problemSlug": "two-sum", "problemTitle": "Two Sum", "difficulty": "Easy",
            "language": "Python", "bestCode": "  return [0, 1]\n",
        }

    def post(self, url, data, client=None):
        return (client or self.client).post(url, json.dumps(data), content_type="application/json")

    def test_home_and_assets(self):
        self.assertContains(self.client.get("/"), "One problem at a time")
        self.assertContains(self.client.get("/"), "Solved history")
        for path in ("mentor/app.js", "mentor/dashboard.css", "brand/leetmentor-mark.svg"):
            self.assertIsNotNone(finders.find(path))
        self.assertEqual(self.client.get("/api/health/").status_code, 200)
        self.assertEqual(self.client.get("/api/study/").status_code, 404)

    def test_history_starts_empty(self):
        self.assertEqual(self.client.get("/api/history/").json()["solutions"], [])

    def test_save_update_and_retrieve_exact_best_code(self):
        response = self.post("/api/history/", self.solution)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["solution"]["bestCode"], self.solution["bestCode"])
        self.solution.update(language="C++", bestCode="return {0, 1};")
        self.assertEqual(self.post("/api/history/", self.solution).status_code, 200)
        self.assertEqual(SavedSolution.objects.count(), 1)
        saved = self.client.get("/api/history/").json()["solutions"][0]
        self.assertEqual(saved["language"], "C++")
        self.assertEqual(saved["bestCode"], "return {0, 1};")

    def test_history_is_newest_first(self):
        self.post("/api/history/", self.solution)
        self.post("/api/history/", {**self.solution, "problemSlug": "three-sum", "problemTitle": "3Sum"})
        self.assertEqual(self.client.get("/api/history/").json()["solutions"][0]["problemSlug"], "three-sum")
        self.post("/api/history/", self.solution)
        self.assertEqual(self.client.get("/api/history/").json()["solutions"][0]["problemSlug"], "two-sum")

    def test_other_browser_cannot_read_or_replace_my_solution(self):
        self.post("/api/history/", self.solution)
        other = Client()
        self.assertEqual(other.get("/api/history/").json()["solutions"], [])
        self.post("/api/history/", {**self.solution, "bestCode": "different", "session_key": self.client.session.session_key}, other)
        self.assertEqual(SavedSolution.objects.count(), 2)
        self.assertEqual(self.client.get("/api/history/").json()["solutions"][0]["bestCode"], self.solution["bestCode"])

    def test_invalid_saves_do_not_change_history(self):
        for change in (
            {"bestCode": " "}, {"bestCode": "x" * 60001}, {"bestCode": []},
            {"problemSlug": "../bad"}, {"problemTitle": ""}, {"language": "Ruby"},
            {"difficulty": "unknown"}, {"language": []},
        ):
            with self.subTest(change=change):
                self.assertEqual(self.post("/api/history/", {**self.solution, **change}).status_code, 400)
        self.assertEqual(SavedSolution.objects.count(), 0)

    def test_json_and_body_limits(self):
        for url, limit in (("/api/history/", 400000), ("/api/assistant/", 600000)):
            for body in ("[]", "{", "null"):
                self.assertEqual(self.client.post(url, body, content_type="application/json").status_code, 400)
            self.assertEqual(self.client.post(url, "x" * (limit + 1), content_type="application/json").status_code, 413)

    def test_csrf_is_required_for_both_posts(self):
        client = Client(enforce_csrf_checks=True)
        for url in ("/api/history/", "/api/assistant/"):
            self.assertEqual(self.post(url, {}, client).status_code, 403)

    def test_save_with_real_csrf_cookie(self):
        client = Client(enforce_csrf_checks=True)
        client.get("/")
        response = client.post("/api/history/", json.dumps(self.solution), content_type="application/json", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value)
        self.assertEqual(response.status_code, 200)

    @patch("mentor.views.leetcode_service")
    def test_daily_and_lookup(self, service):
        service.get_daily_challenge.return_value.to_dict.return_value = PROBLEM
        service.get_problem.return_value.to_dict.return_value = PROBLEM
        self.assertEqual(self.client.get("/api/daily/").json()["problem"], PROBLEM)
        self.assertEqual(self.client.get("/api/problem/", {"identifier": "1"}).json()["problem"], PROBLEM)
        service.get_problem.assert_called_once_with("1")
        service.get_daily_challenge.side_effect = ValueError("Could not reach LeetCode")
        self.assertEqual(self.client.get("/api/daily/").status_code, 503)

    @patch("mentor.views.ai_service.get_answer")
    def test_assistant_response_and_provider_failure(self, answer):
        answer.return_value = {"answer": "Try a hash map."}
        self.assertEqual(self.post("/api/assistant/", {"mode": "hint"}).json()["answer"], "Try a hash map.")
        answer.side_effect = ProviderError("Groq is unavailable")
        self.assertEqual(self.post("/api/assistant/", {"mode": "hint"}).status_code, 502)

    @patch("mentor.views.ai_service.get_answer")
    def test_provider_status_and_message_reach_the_browser(self, answer):
        answer.side_effect = ProviderError("The mentor has reached Groq's usage limit. Wait a little before trying again.", 429)
        response = self.post("/api/assistant/", {"mode": "hint"})
        self.assertEqual(response.status_code, 429)
        self.assertIn("usage limit", response.json()["message"])

    @patch("mentor.views.ASSISTANT_RATE_LIMIT", 1)
    @patch("mentor.views.ai_service.get_answer", return_value={"answer": "Hint"})
    def test_assistant_rate_limit(self, answer):
        self.assertEqual(self.post("/api/assistant/", {}).status_code, 200)
        response = self.post("/api/assistant/", {})
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)


class HistoryMigrationTests(TransactionTestCase):
    def test_completed_records_are_copied_and_old_notes_preserved(self):
        executor = MigrationExecutor(connection)
        old = [("mentor", "0001_initial")]
        new = [("mentor", "0002_savedsolution_and_more")]
        executor.migrate(old)
        try:
            apps = executor.loader.project_state(old).apps
            Record = apps.get_model("mentor", "StudyRecord")
            for status in ("started", "solved", "optimized", "mastered"):
                Record.objects.create(session_key="old-session", problem_slug=status, problem_title=status, status=status, reflection="Keep my notes")
            executor = MigrationExecutor(connection)
            executor.migrate(new)
            self.assertEqual(SavedSolution.objects.filter(session_key="old-session").count(), 3)
            self.assertTrue(all(row.best_code == "" for row in SavedSolution.objects.all()))
            with connection.cursor() as cursor:
                cursor.execute("SELECT reflection FROM mentor_studyrecord WHERE session_key = %s", ["old-session"])
                self.assertEqual(cursor.fetchall(), [("Keep my notes",)] * 4)
        finally:
            MigrationExecutor(connection).migrate(new)
