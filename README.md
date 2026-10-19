# LeetMentor

A small Django app that loads LeetCode problems, gives hints and code reviews,
and saves solved problems with your best code.

## What you can do

1. Load today's daily problem, or search by number, title, slug, or URL.
2. Write or paste code, then ask for a hint or code review.
3. Click **Save as best solution** to mark the problem solved.
4. Open **Solved history** to see your saved code and revisit a problem.

You choose which code is best. Saving again replaces that problem's saved code,
including its language. Drafts are saved separately for each problem and language
in your browser. Opening a problem restores its draft, or its saved solution when
there is no draft.

The app does not run code or submit it to LeetCode. Hints and reviews require a
working Groq API key. The server uses GPT-OSS 120B by default and tries a supported
model if the host still has a retired model configured. Rate limits, invalid keys,
and provider failures show specific messages.

## Run locally

Use Python 3.12 or newer:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

If you already have a `.env`, keep it. Otherwise, edit the copied file and add your
Groq API key. On macOS/Linux use `source .venv/bin/activate` and `cp .env.example .env`.

```powershell
python manage.py migrate
python manage.py runserver
```

Open http://127.0.0.1:8000/. No Node.js or frontend build is needed.

## How to explain the project

> The browser sends requests to Django. Django fetches problems from LeetCode,
> sends the problem and my code to Groq for hints or reviews, and stores my chosen
> best solutions in a database. The page uses plain HTML, CSS, and JavaScript.

Read these six files to understand the app:

| File | Job |
| --- | --- |
| `mentor/views.py` | Handle requests for problems, AI help, and history |
| `mentor/leetcode.py` | Fetch LeetCode data and turn descriptions into readable text |
| `mentor/services.py` | Validate input and ask Groq for a hint or code review |
| `mentor/models.py` | Store one best solution per problem and browser session |
| `static/mentor/app.js` | Connect buttons, display responses, and keep local drafts |
| `templates/mentor/dashboard.html` | The single practice page |

`static/mentor/dashboard.css` styles the page. `mentor/urls.py` maps URLs to views.
`leetcode_mentor_project/` contains Django configuration; `mentor/migrations/`
contains database changes; `mentor/tests.py` checks the main behavior.

A hint follows one path: **Get a hint → app.js → views.py → services.py → Groq → page**.

## Storage

Saved solutions use SQLite locally, or PostgreSQL when `DATABASE_URL` is set.
History belongs to an anonymous browser session, not a LeetCode account. Clearing
cookies or losing the session removes access to that history. Clearing browser
storage removes drafts. There is no login or automatic LeetCode sync.

The simplification migration copies old solved/optimized/mastered records into
history. They have no saved code until you add one, because the old tracker only
stored study notes. The original `mentor_studyrecord` table remains in the database
as an archive, including reflections and review dates. Old browser draft keys are
still supported. Keep both migration files.

## Checks and deployment

```powershell
python manage.py test
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py collectstatic --noinput
```

Tests use a separate database and mock external APIs. POST routes require CSRF.
The assistant is limited to 20 requests per five minutes per session/IP by default
(`ASSISTANT_RATE_LIMIT`); the limiter is local to each server process.

`render.yaml` and `build.sh` support Render. `Dockerfile`, `start.py`, and `Procfile`
are deployment entry points. Production needs `DJANGO_SECRET_KEY`,
`DJANGO_DEBUG=false`, `DJANGO_ALLOWED_HOSTS`, and `GROQ_API_KEY`. `AI_MODEL` can
override the configured Groq model. On Railway, set this in the service Variables
tab: changing `.env` locally or `render.yaml` does not update Railway variables. Use persistent SQLite storage or PostgreSQL
to retain history. The health route checks that the app responds; it does not
check external providers or the database.
