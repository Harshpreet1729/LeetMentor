from __future__ import annotations

import json

from django.http import HttpRequest, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .services import ai_service, leetcode_service


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
    except Exception as error:
        message = str(error)
        status = 500
        if "not found" in message.lower():
            status = 404
        elif "request failed" in message.lower() or "could not reach" in message.lower():
            status = 503
        return JsonResponse({"ok": False, "message": message}, status=status)


@require_GET
def problem_lookup(request: HttpRequest) -> JsonResponse:
    identifier = (request.GET.get("identifier") or "").strip()
    try:
        problem = leetcode_service.get_problem(identifier)
        return JsonResponse({"ok": True, "problem": problem.to_dict()})
    except Exception as error:
        message = str(error)
        status = 404
        if "empty query" in message.lower() or "invalid url" in message.lower():
            status = 400
        elif "could not reach" in message.lower() or "request failed" in message.lower():
            status = 503
        return JsonResponse({"ok": False, "message": message}, status=status)


@require_POST
def assistant_chat(request: HttpRequest) -> JsonResponse:
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return JsonResponse({"ok": False, "message": "Invalid JSON body."}, status=400)

    try:
        response = ai_service.generate_assistant_response(payload)
        return JsonResponse({"ok": True, **response})
    except Exception as error:
        message = str(error)
        status = 400
        if "could not reach" in message.lower():
            status = 503
        return JsonResponse({"ok": False, "message": message}, status=status)
