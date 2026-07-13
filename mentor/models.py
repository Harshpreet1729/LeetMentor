from __future__ import annotations

from datetime import timedelta

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


REVIEW_INTERVAL_DAYS = (1, 3, 7, 21, 45)


def review_interval_for_stage(stage: int) -> timedelta:
    """Return the interval for the number of reviews already completed."""
    index = min(max(stage, 0), len(REVIEW_INTERVAL_DAYS) - 1)
    return timedelta(days=REVIEW_INTERVAL_DAYS[index])


class StudyRecord(models.Model):
    class Status(models.TextChoices):
        STARTED = "started", "Started"
        UNDERSTOOD = "understood", "Understood"
        BRUTE_FORCE = "brute_force", "Brute force"
        SOLVED = "solved", "Solved"
        OPTIMIZED = "optimized", "Optimized"
        MASTERED = "mastered", "Mastered"

    class MistakeCategory(models.TextChoices):
        PROBLEM_UNDERSTANDING = "problem_understanding", "Problem understanding"
        EDGE_CASE = "edge_case", "Edge case"
        ALGORITHM_CHOICE = "algorithm_choice", "Algorithm choice"
        IMPLEMENTATION = "implementation", "Implementation"
        COMPLEXITY = "complexity", "Complexity"
        NONE = "none", "No mistake"

    REVIEWABLE_STATUSES = frozenset(
        {Status.SOLVED, Status.OPTIMIZED, Status.MASTERED}
    )

    session_key = models.CharField(max_length=40, db_index=True)
    problem_slug = models.CharField(max_length=255)
    problem_title = models.CharField(max_length=300)
    frontend_id = models.CharField(max_length=30, blank=True)
    difficulty = models.CharField(max_length=10, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.STARTED,
    )
    confidence = models.PositiveSmallIntegerField(
        default=3,
        validators=[MinValueValidator(1), MaxValueValidator(5)],
    )
    mistake_category = models.CharField(
        max_length=30,
        choices=[("", "Not recorded"), *MistakeCategory.choices],
        blank=True,
        default="",
    )
    reflection = models.TextField(max_length=4000, blank=True, default="")
    review_stage = models.PositiveSmallIntegerField(default=0)
    next_review_at = models.DateTimeField(null=True, blank=True)
    last_reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("session_key", "problem_slug"),
                name="unique_study_record_per_session_problem",
            ),
            models.CheckConstraint(
                condition=models.Q(confidence__gte=1, confidence__lte=5),
                name="study_confidence_between_1_and_5",
            ),
            models.CheckConstraint(
                condition=models.Q(review_stage__gte=0),
                name="study_review_stage_nonnegative",
            ),
        ]
        indexes = [
            models.Index(
                fields=("session_key", "next_review_at"),
                name="study_session_review_idx",
            )
        ]
        ordering = ("next_review_at", "pk")

    def save(self, *args, **kwargs) -> None:
        if self.status in self.REVIEWABLE_STATUSES and self.next_review_at is None:
            self.next_review_at = timezone.now() + review_interval_for_stage(self.review_stage)

        update_fields = kwargs.get("update_fields")
        if update_fields is not None and self.next_review_at is not None:
            kwargs["update_fields"] = set(update_fields) | {"next_review_at"}
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.session_key}:{self.problem_slug}"
