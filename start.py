from __future__ import annotations

import os
import subprocess
import sys


def main() -> None:
    subprocess.run(
        [sys.executable, "manage.py", "migrate", "--noinput"],
        check=True,
    )

    port = os.environ.get("PORT", "8000")
    os.execvp(
        "gunicorn",
        [
            "gunicorn",
            "leetcode_mentor_project.wsgi:application",
            "--bind",
            f"0.0.0.0:{port}",
            "--timeout",
            "90",
            "--graceful-timeout",
            "30",
            "--keep-alive",
            "5",
        ],
    )


if __name__ == "__main__":
    main()
