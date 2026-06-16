from django.urls import path

from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("api/daily/", views.daily_problem, name="daily-problem"),
    path("api/problem/", views.problem_lookup, name="problem-lookup"),
    path("api/assistant/", views.assistant_chat, name="assistant-chat"),
]
