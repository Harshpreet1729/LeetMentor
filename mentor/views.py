from __future__ import annotations

import json
import logging
import os
import re
import time
from collections import defaultdict, deque
from threading import Lock

from django.http import HttpRequest, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .models import SavedSolution
from .leetcode import leetcode_service
from .services import LANGUAGES, ProviderError, ai_service


logger = logging.getLogger(__name__)
MAX_ASSISTANT_BODY_BYTES = 600_000
ASSISTANT_RATE_LIMIT = max(1, int(os.environ.get("ASSISTANT_RATE_LIMIT", "20")))
ASSISTANT_RATE_WINDOW_SECONDS = 5 * 60
_assistant_request_times: defaultdict[str, deque[float]] = defaultdict(deque)
_assistant_rate_lock = Lock()
_PROBLEM_SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class RequestValidationError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _read_json(request: HttpRequest, max_bytes: int) -> dict[str, object]:
    if len(request.body) > max_bytes:
        raise RequestValidationError("Request is too large.", status=413)
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RequestValidationError("Invalid JSON body.") from error
    if not isinstance(payload, dict):
        raise RequestValidationError("JSON body must be an object.")
    return payload


def _solution_json(solution):
    return {
        "problemSlug": solution.problem_slug,
        "problemTitle": solution.problem_title,
        "difficulty": solution.difficulty,
        "language": solution.language,
        "bestCode": solution.best_code,
        "updatedAt": solution.updated_at.isoformat(),
    }


@require_http_methods(["GET", "POST"])
def history(request):
    try:
        if not request.session.session_key:
            request.session.create()
        records = SavedSolution.objects.filter(session_key=request.session.session_key)
        if request.method == "GET":
            return JsonResponse({"ok": True, "solutions": [_solution_json(row) for row in records]})

        payload = _read_json(request, 400_000)
        fields = {}
        for key, column, limit in (
            ("problemSlug", "problem_slug", 255),
            ("problemTitle", "problem_title", 300),
            ("difficulty", "difficulty", 10),
            ("language", "language", 20),
            ("bestCode", "best_code", 60000),
        ):
            value = payload.get(key)
            if not isinstance(value, str) or not value.strip() or len(value) > limit:
                raise RequestValidationError(f"{key} is required and must be at most {limit} characters.")
            fields[column] = value if key == "bestCode" else value.strip()
        if not _PROBLEM_SLUG_PATTERN.fullmatch(fields["problem_slug"]):
            raise RequestValidationError("Invalid problem slug.")
        if fields["language"] not in LANGUAGES:
            raise RequestValidationError("Unsupported programming language.")
        if fields["difficulty"] not in {"Easy", "Medium", "Hard"}:
            raise RequestValidationError("Invalid difficulty.")
        slug = fields.pop("problem_slug")
        solution, _ = SavedSolution.objects.update_or_create(
            session_key=request.session.session_key, problem_slug=slug, defaults=fields,
        )
        return JsonResponse({"ok": True, "solution": _solution_json(solution)})
    except RequestValidationError as error:
        return JsonResponse({"ok": False, "message": str(error)}, status=error.status)
    except Exception:
        logger.exception("History request failed")
        return JsonResponse({"ok": False, "message": "Unable to access saved solutions. Please try again."}, status=500)


def _assistant_client_key(request: HttpRequest) -> str:
    session_key = request.session.session_key
    if session_key:
        return f"session:{session_key}"

    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
    client_address = forwarded_for.split(",", 1)[0].strip()
    if not client_address:
        client_address = request.META.get("REMOTE_ADDR", "unknown")
    return f"ip:{client_address}"


def _assistant_retry_after(request: HttpRequest) -> int | None:
    now = time.monotonic()
    cutoff = now - ASSISTANT_RATE_WINDOW_SECONDS
    key = _assistant_client_key(request)
    with _assistant_rate_lock:
        timestamps = _assistant_request_times[key]
        while timestamps and timestamps[0] <= cutoff:
            timestamps.popleft()
        if len(timestamps) >= ASSISTANT_RATE_LIMIT:
            elapsed = now - timestamps[0]
            remaining = int(ASSISTANT_RATE_WINDOW_SECONDS - elapsed)
            return max(1, remaining)
        timestamps.append(now)
    return None


@ensure_csrf_cookie
def home(request: HttpRequest):
    return render(request, "mentor/dashboard.html")


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
        normalized = message.lower()
        if "not found" in normalized:
            status = 404
        elif "request failed" in normalized or "could not reach" in normalized:
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
        normalized = message.lower()
        if "empty query" in normalized or "invalid url" in normalized:
            status = 400
        elif "could not reach" in normalized or "request failed" in normalized:
            status = 503
        return JsonResponse({"ok": False, "message": message}, status=status)
    except Exception:
        logger.exception("Unexpected problem lookup failure")
        return JsonResponse({"ok": False, "message": "Unable to load that problem."}, status=500)


@require_POST
def assistant_chat(request: HttpRequest) -> JsonResponse:
    try:
        payload = _read_json(request, MAX_ASSISTANT_BODY_BYTES)
    except RequestValidationError as error:
        return JsonResponse({"ok": False, "message": str(error)}, status=error.status)

    retry_after = _assistant_retry_after(request)
    if retry_after is not None:
        response = JsonResponse(
            {"ok": False, "message": "Too many mentor requests. Pause briefly and try again."},
            status=429,
        )
        response["Retry-After"] = str(retry_after)
        return response

    try:
        response = ai_service.get_answer(payload)
        return JsonResponse({"ok": True, **response})
    except ProviderError as error:
        return JsonResponse({"ok": False, "message": str(error)}, status=error.status)
    except ValueError as error:
        return JsonResponse({"ok": False, "message": str(error)}, status=400)
    except Exception:
        logger.exception("Unexpected mentor response failure")
        return JsonResponse({"ok": False, "message": "Unable to generate a mentor response."}, status=500)
