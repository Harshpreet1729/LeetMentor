from django.db import models


class SavedSolution(models.Model):
    session_key = models.CharField(max_length=40, db_index=True)
    problem_slug = models.SlugField(max_length=255)
    problem_title = models.CharField(max_length=300)
    difficulty = models.CharField(max_length=10, blank=True)
    language = models.CharField(max_length=20, blank=True)
    best_code = models.TextField(max_length=60000, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["session_key", "problem_slug"], name="one_solution_per_problem"
            )
        ]

    def __str__(self):
        return self.problem_title
