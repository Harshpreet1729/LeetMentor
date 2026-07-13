from __future__ import annotations

import json
from datetime import timedelta
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import Client, SimpleTestCase, TestCase
from django.utils import timezone

from .models import StudyRecord
from .services import AIService, LeetCodeService
from . import views


class AssistantServiceTests(SimpleTestCase):
    def setUp(self) -> None:
        self.service = AIService()
        self.problem = {
            "title": "Group Anagrams",
            "titleSlug": "group-anagrams",
            "questionFrontendId": "49",
            "difficulty": "Medium",
            "statement": "Group strings that are anagrams of each other.",
            "examples": ["Input: strs = [eat, tea]\nOutput: [[eat, tea]]"],
            "constraints": ["1 <= strs.length <= 10^4"],
            "tags": ["Array", "Hash Table", "String", "Sorting"],
        }

    def test_rejects_unknown_mode_before_provider_use(self) -> None:
        with self.assertRaisesMessage(ValueError, "Unsupported mentor mode"):
            self.service.generate_assistant_response({"mode": "invented"})

    def test_rejects_non_numeric_hint_level(self) -> None:
        with self.assertRaisesMessage(ValueError, "Hint level"):
            self.service.generate_assistant_response({"mode": "hint", "hintLevel": "three"})

    def test_rejects_oversized_question(self) -> None:
        with self.assertRaisesMessage(ValueError, "userQuestion is too long"):
            self.service.generate_assistant_response({"mode": "hint", "userQuestion": "x" * 4_001})

    def test_hash_table_fallback_does_not_assume_two_sum(self) -> None:
        answer = self.service._generate_progressive_hint(self.problem, 1)
        self.assertIsNotNone(answer)
        self.assertNotIn("target - nums", answer or "")
        self.assertNotIn("partner", (answer or "").lower())
        self.assertIn("lookup key", (answer or "").lower())

    @patch.dict("os.environ", {"GROQ_API_KEY": ""})
    def test_full_solution_is_not_faked_without_provider(self) -> None:
        with self.assertRaisesMessage(ValueError, "Missing GROQ_API_KEY"):
            self.service.generate_assistant_response(
                {"mode": "full_solution", "problem": self.problem, "language": "Python"}
            )


class LeetCodeServiceTests(SimpleTestCase):
    def setUp(self) -> None:
        self.service = LeetCodeService()

    def test_resolves_standard_leetcode_url(self) -> None:
        self.assertEqual(
            self.service._resolve_slug("https://leetcode.com/problems/two-sum/description/"),
            "two-sum",
        )

    def test_rejects_non_leetcode_url(self) -> None:
        with self.assertRaisesMessage(ValueError, "Only LeetCode"):
            self.service._resolve_slug("https://example.com/problems/two-sum/")

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


class MentorEndpointTests(TestCase):
    def setUp(self) -> None:
        views._assistant_request_times.clear()

    def test_home_and_health_render(self) -> None:
        self.assertContains(self.client.get("/"), "LeetMentor practice desk")
        self.assertJSONEqual(self.client.get("/api/health/").content, {"ok": True, "status": "ready"})

    def test_problem_lookup_requires_identifier(self) -> None:
        response = self.client.get("/api/problem/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["message"], "Empty query. Enter a problem number, title slug, title, or LeetCode URL.")

    def test_assistant_rejects_non_object_json(self) -> None:
        response = self.client.post("/api/assistant/", data="[]", content_type="application/json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["message"], "JSON body must be an object.")

    def test_assistant_rejects_invalid_mode_with_stable_error(self) -> None:
        response = self.client.post(
            "/api/assistant/",
            data=json.dumps({"mode": "wat"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["message"], "Unsupported mentor mode.")

    def test_assistant_rejects_oversized_body(self) -> None:
        response = self.client.post(
            "/api/assistant/",
            data=json.dumps({"mode": "hint", "userQuestion": "x" * 161_000}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 413)

    @patch("mentor.views.ai_service.generate_assistant_response")
    def test_assistant_returns_service_response(self, generate) -> None:
        generate.return_value = {"answer": "A grounded hint.", "suggestedNextStep": "Try it."}
        response = self.client.post(
            "/api/assistant/",
            data=json.dumps({"mode": "hint", "hintLevel": 1}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["answer"], "A grounded hint.")

    @patch("mentor.views.ASSISTANT_RATE_LIMIT", 1)
    @patch("mentor.views.ai_service.generate_assistant_response")
    def test_assistant_rate_limit_returns_retry_after(self, generate) -> None:
        generate.return_value = {"answer": "Hint"}
        payload = json.dumps({"mode": "hint", "hintLevel": 1})
        self.assertEqual(self.client.post("/api/assistant/", data=payload, content_type="application/json").status_code, 200)
        response = self.client.post("/api/assistant/", data=payload, content_type="application/json")
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)


class StudyRecordModelTests(TestCase):
    def make_record(self, **overrides) -> StudyRecord:
        values = {
            "session_key": "a" * 32,
            "problem_slug": "two-sum",
            "problem_title": "Two Sum",
        }
        values.update(overrides)
        return StudyRecord.objects.create(**values)

    def test_only_reviewable_statuses_get_an_initial_schedule(self) -> None:
        now = timezone.now()
        for index, status in enumerate(("started", "understood", "brute_force")):
            record = self.make_record(problem_slug=f"not-due-{index}", status=status)
            self.assertIsNone(record.next_review_at)

        for index, status in enumerate(("solved", "optimized", "mastered")):
            with patch("mentor.models.timezone.now", return_value=now):
                record = self.make_record(problem_slug=f"due-{index}", status=status)
            self.assertEqual(record.next_review_at, now + timedelta(days=1))

    def test_existing_schedule_is_preserved_on_later_save(self) -> None:
        scheduled = timezone.now() + timedelta(days=7)
        record = self.make_record(status="solved", next_review_at=scheduled)
        record.confidence = 5
        record.save()
        self.assertEqual(record.next_review_at, scheduled)

    def test_database_enforces_confidence_range(self) -> None:
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.make_record(confidence=0)

    def test_unique_problem_per_session(self) -> None:
        self.make_record()
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.make_record(problem_title="Duplicate")


class StudyEndpointTests(TestCase):
    def post_study(self, payload: dict, *, client: Client | None = None):
        return (client or self.client).post(
            "/api/study/",
            data=json.dumps(payload),
            content_type="application/json",
        )

    def base_payload(self, **overrides) -> dict:
        payload = {
            "problemSlug": "two-sum",
            "problemTitle": "Two Sum",
            "frontendId": "1",
            "difficulty": "Easy",
            "status": "started",
            "confidence": 3,
            "mistakeCategory": "",
            "reflection": "",
        }
        payload.update(overrides)
        return payload

    def test_get_creates_session_and_returns_empty_state(self) -> None:
        response = self.client.get("/api/study/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(self.client.session.session_key)
        self.assertEqual(response.json(), {"ok": True, "record": None, "queue": []})

    def test_save_creates_and_partially_updates_one_record(self) -> None:
        create_response = self.post_study(self.base_payload()).json()
        created = create_response["record"]
        self.assertEqual(create_response["queue"], [])
        self.assertEqual(created["problemSlug"], "two-sum")
        self.assertEqual(created["status"], "started")
        self.assertIsNone(created["nextReviewAt"])

        updated = self.post_study(
            {"problemSlug": "two-sum", "confidence": 5, "reflection": "Missed duplicates."}
        ).json()["record"]
        self.assertEqual(updated["id"], created["id"])
        self.assertEqual(updated["problemTitle"], "Two Sum")
        self.assertEqual(updated["confidence"], 5)
        self.assertEqual(StudyRecord.objects.count(), 1)

    def test_first_solved_save_schedules_one_day_from_now(self) -> None:
        now = timezone.now()
        with patch("mentor.models.timezone.now", return_value=now):
            response = self.post_study(self.base_payload(status="solved"))
        self.assertEqual(response.status_code, 200)
        record = StudyRecord.objects.get()
        self.assertEqual(record.review_stage, 0)
        self.assertEqual(record.next_review_at, now + timedelta(days=1))

    def test_review_advances_stage_and_uses_spaced_intervals(self) -> None:
        self.post_study(self.base_payload(status="solved"))
        expected_days = (3, 7, 21, 45, 45)
        base = timezone.now()
        for expected_stage, days in enumerate(expected_days, start=1):
            now = base + timedelta(hours=expected_stage)
            with patch("mentor.views.timezone.now", return_value=now):
                response = self.post_study(
                    {
                        "action": "reviewed",
                        "problemSlug": "two-sum",
                        "expectedReviewStage": expected_stage - 1,
                    }
                )
            self.assertEqual(response.status_code, 200)
            data = response.json()["record"]
            self.assertEqual(data["reviewStage"], expected_stage)
            record = StudyRecord.objects.get()
            self.assertEqual(record.last_reviewed_at, now)
            self.assertEqual(record.next_review_at, now + timedelta(days=days))

    def test_stale_review_stage_is_rejected_without_advancing(self) -> None:
        self.post_study(self.base_payload(status="solved"))
        first = self.post_study(
            {"action": "reviewed", "problemSlug": "two-sum", "expectedReviewStage": 0}
        )
        self.assertEqual(first.status_code, 200)
        stale = self.post_study(
            {"action": "reviewed", "problemSlug": "two-sum", "expectedReviewStage": 0}
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["record"]["reviewStage"], 1)
        self.assertEqual(StudyRecord.objects.get().review_stage, 1)

    def test_queue_is_ordered_and_marks_due_at_exact_boundary(self) -> None:
        self.post_study(self.base_payload(problemSlug="later", problemTitle="Later", status="solved"))
        self.post_study(self.base_payload(problemSlug="due-now", problemTitle="Due now", status="solved"))
        now = timezone.now()
        StudyRecord.objects.filter(problem_slug="later").update(next_review_at=now + timedelta(days=1))
        StudyRecord.objects.filter(problem_slug="due-now").update(next_review_at=now)

        with patch("mentor.views.timezone.now", return_value=now):
            response = self.client.get("/api/study/?problem_slug=due-now")
        data = response.json()
        self.assertEqual(data["record"]["problemSlug"], "due-now")
        self.assertTrue(data["record"]["due"])
        self.assertEqual([item["problemSlug"] for item in data["queue"]], ["due-now", "later"])
        self.assertTrue(data["queue"][0]["due"])
        self.assertFalse(data["queue"][1]["due"])

    def test_records_are_isolated_by_server_session(self) -> None:
        other = Client()
        first = self.post_study(
            self.base_payload(reflection="first session", status="solved")
        ).json()["record"]
        second = self.post_study(
            self.base_payload(reflection="other session", status="solved"), client=other
        ).json()["record"]
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(StudyRecord.objects.filter(problem_slug="two-sum").count(), 2)

        own = self.client.get("/api/study/?problem_slug=two-sum").json()["record"]
        theirs = other.get("/api/study/?problem_slug=two-sum").json()["record"]
        self.assertEqual(own["reflection"], "first session")
        self.assertEqual(theirs["reflection"], "other session")

        guessed = self.post_study(
            {
                "action": "reviewed",
                "problemSlug": "two-sum",
                "id": first["id"],
                "expectedReviewStage": 0,
            },
            client=other,
        )
        self.assertEqual(guessed.status_code, 200)
        self.assertEqual(StudyRecord.objects.get(pk=first["id"]).review_stage, 0)
        self.assertEqual(StudyRecord.objects.get(pk=second["id"]).review_stage, 1)

    def test_review_cannot_access_another_sessions_record(self) -> None:
        self.post_study(self.base_payload(status="solved"))
        other = Client()
        response = self.post_study(
            {"action": "reviewed", "problemSlug": "two-sum"}, client=other
        )
        self.assertEqual(response.status_code, 404)

    def test_unscheduled_record_cannot_be_marked_reviewed(self) -> None:
        self.post_study(self.base_payload(status="understood"))
        response = self.post_study(
            {"action": "reviewed", "problemSlug": "two-sum", "expectedReviewStage": 0}
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["message"], "This problem is not scheduled for review.")
        self.assertEqual(StudyRecord.objects.get().review_stage, 0)

    def test_validation_returns_stable_client_errors(self) -> None:
        cases = (
            ({"problemSlug": "two-sum"}, "problemTitle is required."),
            (self.base_payload(confidence=True), "confidence must be an integer from 1 to 5."),
            (self.base_payload(confidence=6), "confidence must be an integer from 1 to 5."),
            (self.base_payload(status="finished"), "status is not supported."),
            (self.base_payload(mistakeCategory="mystery"), "mistakeCategory is not supported."),
            (self.base_payload(reflection="x" * 4001), "reflection is too long."),
        )
        for payload, message in cases:
            with self.subTest(message=message):
                response = self.post_study(payload)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {"ok": False, "message": message})

    def test_get_validates_problem_slug(self) -> None:
        for slug in ("not/a/slug", "x" * 256):
            with self.subTest(slug=slug[:20]):
                response = self.client.get("/api/study/", {"problem_slug": slug})
                self.assertEqual(response.status_code, 400)

    def test_rejects_invalid_json_non_object_and_large_body(self) -> None:
        invalid = self.client.post("/api/study/", data="{", content_type="application/json")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["message"], "Invalid JSON body.")

        non_object = self.client.post("/api/study/", data="[]", content_type="application/json")
        self.assertEqual(non_object.status_code, 400)
        self.assertEqual(non_object.json()["message"], "JSON body must be an object.")

        too_large = self.client.post(
            "/api/study/",
            data=json.dumps({"reflection": "x" * 21_000}),
            content_type="application/json",
        )
        self.assertEqual(too_large.status_code, 413)

    def test_post_requires_csrf_token_when_enforced(self) -> None:
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.get("/")
        response = csrf_client.post(
            "/api/study/",
            data=json.dumps(self.base_payload()),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
