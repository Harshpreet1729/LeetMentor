from __future__ import annotations

import json
import logging
import os
import re
import time
from collections import defaultdict, deque
from threading import Lock

from django.db import transaction
from django.http import HttpRequest, JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .models import StudyRecord, review_interval_for_stage
from .services import ai_service, leetcode_service


logger = logging.getLogger(__name__)
MAX_ASSISTANT_BODY_BYTES = 160_000
MAX_STUDY_BODY_BYTES = 20_000
MAX_STUDY_QUEUE_SIZE = 100
ASSISTANT_RATE_LIMIT = max(1, int(os.environ.get("ASSISTANT_RATE_LIMIT", "20")))
ASSISTANT_RATE_WINDOW_SECONDS = 5 * 60
_assistant_request_times: defaultdict[str, deque[float]] = defaultdict(deque)
_assistant_rate_lock = Lock()
_PROBLEM_SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class StudyValidationError(ValueError):
    pass


def _session_key(request: HttpRequest) -> str:
    if not request.session.session_key:
        request.session.create()
    # SessionStore.create() guarantees a key; keeping the check explicit avoids
    # ever querying records with an empty owner key.
    session_key = request.session.session_key
    if not session_key:
        raise RuntimeError("Unable to create a study session.")
    return session_key


def _problem_slug(value: object, *, required: bool = True) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise StudyValidationError("problemSlug must be a string.")
    slug = value.strip().lower()
    if not slug:
        raise StudyValidationError("problemSlug is required.")
    if len(slug) > 255:
        raise StudyValidationError("problemSlug is too long.")
    if not _PROBLEM_SLUG_PATTERN.fullmatch(slug):
        raise StudyValidationError("problemSlug must be a valid LeetCode slug.")
    return slug


def _optional_string(
    payload: dict[str, object], key: str, max_length: int, *, allow_blank: bool = True
) -> str | None:
    if key not in payload:
        return None
    value = payload[key]
    if not isinstance(value, str):
        raise StudyValidationError(f"{key} must be a string.")
    if len(value) > max_length:
        raise StudyValidationError(f"{key} is too long.")
    value = value.strip()
    if not allow_blank and not value:
        raise StudyValidationError(f"{key} is required.")
    return value


def _study_record_json(record: StudyRecord, now=None) -> dict[str, object]:
    now = now or timezone.now()
    return {
        "id": record.pk,
        "problemSlug": record.problem_slug,
        "problemTitle": record.problem_title,
        "frontendId": record.frontend_id,
        "difficulty": record.difficulty,
        "status": record.status,
        "confidence": record.confidence,
        "mistakeCategory": record.mistake_category,
        "reflection": record.reflection,
        "reviewStage": record.review_stage,
        "nextReviewAt": record.next_review_at.isoformat() if record.next_review_at else None,
        "lastReviewedAt": record.last_reviewed_at.isoformat() if record.last_reviewed_at else None,
        "createdAt": record.created_at.isoformat(),
        "updatedAt": record.updated_at.isoformat(),
        "due": bool(record.next_review_at and record.next_review_at <= now),
    }


def _study_queue(session_key: str, now=None) -> list[dict[str, object]]:
    now = now or timezone.now()
    records = (
        StudyRecord.objects.filter(session_key=session_key, next_review_at__isnull=False)
        .order_by("next_review_at", "pk")[:MAX_STUDY_QUEUE_SIZE]
    )
    return [_study_record_json(record, now) for record in records]


def _study_payload(request: HttpRequest) -> dict[str, object]:
    if len(request.body) > MAX_STUDY_BODY_BYTES:
        raise StudyValidationError("Request is too large.")
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise StudyValidationError("Invalid JSON body.") from error
    if not isinstance(payload, dict):
        raise StudyValidationError("JSON body must be an object.")
    return payload


def _validated_study_updates(payload: dict[str, object], *, creating: bool) -> dict[str, object]:
    updates: dict[str, object] = {}
    title = _optional_string(payload, "problemTitle", 300, allow_blank=False)
    if creating and title is None:
        raise StudyValidationError("problemTitle is required.")
    if title is not None:
        updates["problem_title"] = title

    frontend_id = _optional_string(payload, "frontendId", 30)
    if frontend_id is not None:
        updates["frontend_id"] = frontend_id

    difficulty = _optional_string(payload, "difficulty", 10)
    if difficulty is not None:
        if difficulty not in {"", "Easy", "Medium", "Hard"}:
            raise StudyValidationError("difficulty must be Easy, Medium, or Hard.")
        updates["difficulty"] = difficulty

    if "status" in payload:
        status = payload["status"]
        if not isinstance(status, str) or status not in StudyRecord.Status.values:
            raise StudyValidationError("status is not supported.")
        updates["status"] = status

    if "confidence" in payload:
        confidence = payload["confidence"]
        if isinstance(confidence, bool) or not isinstance(confidence, int) or not 1 <= confidence <= 5:
            raise StudyValidationError("confidence must be an integer from 1 to 5.")
        updates["confidence"] = confidence

    if "mistakeCategory" in payload:
        mistake = payload["mistakeCategory"]
        valid_mistakes = {"", *StudyRecord.MistakeCategory.values}
        if not isinstance(mistake, str) or mistake not in valid_mistakes:
            raise StudyValidationError("mistakeCategory is not supported.")
        updates["mistake_category"] = mistake

    reflection = _optional_string(payload, "reflection", 4000)
    if reflection is not None:
        updates["reflection"] = reflection
    return updates


@require_http_methods(["GET", "POST"])
def study_records(request: HttpRequest) -> JsonResponse:
    try:
        session_key = _session_key(request)
        if request.method == "GET":
            slug = _problem_slug(request.GET.get("problem_slug"), required=False)
            record = None
            if slug is not None:
                record = StudyRecord.objects.filter(
                    session_key=session_key, problem_slug=slug
                ).first()
            now = timezone.now()
            return JsonResponse(
                {
                    "ok": True,
                    "record": _study_record_json(record, now) if record else None,
                    "queue": _study_queue(session_key, now),
                }
            )

        payload = _study_payload(request)
        action = payload.get("action", "save")
        if not isinstance(action, str) or action not in {"save", "reviewed"}:
            raise StudyValidationError("action must be save or reviewed.")
        slug = _problem_slug(payload.get("problemSlug"))

        if action == "reviewed":
            expected_stage = payload.get("expectedReviewStage")
            if expected_stage is not None and (
                isinstance(expected_stage, bool)
                or not isinstance(expected_stage, int)
                or not 0 <= expected_stage <= 32767
            ):
                raise StudyValidationError("expectedReviewStage must be a non-negative integer.")
            with transaction.atomic():
                record = StudyRecord.objects.select_for_update().filter(
                    session_key=session_key, problem_slug=slug
                ).first()
                if record is None:
                    return JsonResponse(
                        {"ok": False, "message": "Study record not found."}, status=404
                    )
                if record.next_review_at is None:
                    return JsonResponse(
                        {
                            "ok": False,
                            "message": "This problem is not scheduled for review.",
                        },
                        status=409,
                    )
                if expected_stage is not None and record.review_stage != expected_stage:
                    return JsonResponse(
                        {
                            "ok": False,
                            "message": "This review was already updated. Refresh and try again.",
                            "record": _study_record_json(record),
                        },
                        status=409,
                    )
                reviewed_at = timezone.now()
                record.review_stage = min(record.review_stage + 1, 32767)
                record.last_reviewed_at = reviewed_at
                record.next_review_at = reviewed_at + review_interval_for_stage(record.review_stage)
                record.save(
                    update_fields=(
                        "review_stage",
                        "last_reviewed_at",
                        "next_review_at",
                        "updated_at",
                    )
                )
        else:
            updates = _validated_study_updates(payload, creating=False)
            with transaction.atomic():
                record, created = StudyRecord.objects.select_for_update().get_or_create(
                    session_key=session_key,
                    problem_slug=slug,
                    defaults={"problem_title": updates.get("problem_title", "")},
                )
                if created and "problem_title" not in updates:
                    raise StudyValidationError("problemTitle is required.")
                for field, value in updates.items():
                    setattr(record, field, value)
                record.save()

        response_time = timezone.now()
        return JsonResponse(
            {
                "ok": True,
                "record": _study_record_json(record, response_time),
                "queue": _study_queue(session_key, response_time),
            }
        )
    except StudyValidationError as error:
        status = 413 if str(error) == "Request is too large." else 400
        return JsonResponse({"ok": False, "message": str(error)}, status=status)
    except Exception:
        logger.exception("Unexpected study record failure")
        return JsonResponse(
            {"ok": False, "message": "Unable to update study progress."}, status=500
        )


def _assistant_client_key(request: HttpRequest) -> str:
    if not request.session.session_key:
        request.session.create()
    return request.session.session_key or request.META.get("REMOTE_ADDR", "unknown")


def _assistant_retry_after(request: HttpRequest) -> int | None:
    now = time.monotonic()
    cutoff = now - ASSISTANT_RATE_WINDOW_SECONDS
    key = _assistant_client_key(request)
    with _assistant_rate_lock:
        timestamps = _assistant_request_times[key]
        while timestamps and timestamps[0] <= cutoff:
            timestamps.popleft()
        if len(timestamps) >= ASSISTANT_RATE_LIMIT:
            return max(1, int(ASSISTANT_RATE_WINDOW_SECONDS - (now - timestamps[0])))
        timestamps.append(now)
    return None


@ensure_csrf_cookie
def home(request: HttpRequest):
    return render(
        request,
        "mentor/dashboard.html",
        {
            "default_language": "C++",
            "default_model": "llama-3.3-70b-versatile",
        },
    )


@require_GET
def health_check(_request: HttpRequest) -> JsonResponse:
    return JsonResponse({"ok": True, "status": "ready"})


@require_GET
def daily_problem(request: HttpRequest) -> JsonResponse:
    try:
        problem = leetcode_service.get_daily_challenge()
        return JsonResponse({"ok": True, "problem": problem.to_dict()})
    except ValueError as error:
        message = str(error)
        status = 500
        if "not found" in message.lower():
            status = 404
        elif "request failed" in message.lower() or "could not reach" in message.lower():
            status = 503
        return JsonResponse({"ok": False, "message": message}, status=status)
    except Exception:
        logger.exception("Unexpected daily problem failure")
        return JsonResponse({"ok": False, "message": "Unable to load the daily problem."}, status=500)


@require_GET
def problem_lookup(request: HttpRequest) -> JsonResponse:
    identifier = (request.GET.get("identifier") or "").strip()
    try:
        problem = leetcode_service.get_problem(identifier)
        return JsonResponse({"ok": True, "problem": problem.to_dict()})
    except ValueError as error:
        message = str(error)
        status = 404
        if "empty query" in message.lower() or "invalid url" in message.lower():
            status = 400
        elif "could not reach" in message.lower() or "request failed" in message.lower():
            status = 503
        return JsonResponse({"ok": False, "message": message}, status=status)
    except Exception:
        logger.exception("Unexpected problem lookup failure")
        return JsonResponse({"ok": False, "message": "Unable to load that problem."}, status=500)


@require_POST
def assistant_chat(request: HttpRequest) -> JsonResponse:
    if len(request.body) > MAX_ASSISTANT_BODY_BYTES:
        return JsonResponse({"ok": False, "message": "Request is too large."}, status=413)

    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return JsonResponse({"ok": False, "message": "Invalid JSON body."}, status=400)

    if not isinstance(payload, dict):
        return JsonResponse({"ok": False, "message": "JSON body must be an object."}, status=400)

    retry_after = _assistant_retry_after(request)
    if retry_after is not None:
        response = JsonResponse(
            {"ok": False, "message": "Too many mentor requests. Pause briefly and try again."},
            status=429,
        )
        response["Retry-After"] = str(retry_after)
        return response

    try:
        response = ai_service.generate_assistant_response(payload)
        return JsonResponse({"ok": True, **response})
    except ValueError as error:
        message = str(error)
        status = 400
        normalized = message.lower()
        if "missing groq_api_key" in normalized or "could not reach" in normalized:
            status = 503
        elif "groq" in normalized:
            status = 502
            message = "The mentor provider is temporarily unavailable. Please try again."
        return JsonResponse({"ok": False, "message": message}, status=status)
    except Exception:
        logger.exception("Unexpected mentor response failure")
        return JsonResponse({"ok": False, "message": "Unable to generate a mentor response."}, status=500)
