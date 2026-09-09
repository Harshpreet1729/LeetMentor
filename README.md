# LeetMentor

A Django web app for LeetCode practice: load a problem, write your attempt, ask for focused help, and save what you learned.

## Run locally

Use Python 3.12 or newer. No Node.js, npm build, or Chrome extension is needed.

```bash
python -m venv .venv
```

Activate the environment on Windows:

```powershell
.venv\Scripts\Activate.ps1
```

On macOS or Linux, use `source .venv/bin/activate`.

```bash
python -m pip install -r requirements.txt
```

Copy `.env.example` to `.env` and add your Groq API key. Keep `.env` private.

```bash
python manage.py migrate
python manage.py runserver
```

Open http://127.0.0.1:8000/.

## What it does

- Fetch a LeetCode problem by number, title, slug, or URL, or load the daily challenge.
- Show the problem summary, examples, constraints, difficulty, and topics.
- Save code drafts separately for each problem and language in the browser.
- Generate hints, explanations, code reviews, complexity analysis, dry runs, and optimization advice through Groq.
- Save a learning checkpoint, confidence, mistake category, and reflection using Django.
- Schedule revisions after 1, 3, 7, 21, and 45 days. Later reviews repeat the 45-day interval.

The editor stores code; it does not execute or submit it to LeetCode. The full-solution mode is also supported by the assistant API. The dashboard provides links to ChatGPT and YouTube for additional help.

Without a working Groq connection, hints, explanations, and basic review checks have limited local fallbacks. Complexity, dry runs, optimization, and full solutions require the provider; the app does not substitute canned solutions for those actions.

## How the code works

This is a normal Django project with function-based views and plain browser JavaScript.

| File | Responsibility |
| --- | --- |
| `leetcode_mentor_project/settings.py` | Environment, database, middleware, and static-file settings |
| `leetcode_mentor_project/urls.py` | Connect the project to the mentor app and Django admin |
| `mentor/urls.py` | Map each URL to its view |
| `mentor/views.py` | Validate HTTP requests and return HTML or JSON |
| `mentor/leetcode.py` | Fetch and parse LeetCode problem data; cache fetched problems in memory |
| `mentor/services.py` | Validate mentor inputs, call Groq, and check the response |
| `mentor/prompts.py` | Teaching instructions for the AI |
| `mentor/models.py` | Store study records and schedule their first review |
| `mentor/migrations/` | Create the database schema; keep these for new installations |
| `mentor/tests.py` | Regression tests for services, endpoints, and study records |
| `templates/base.html` | Shared page layout |
| `templates/mentor/dashboard.html` | Problem loader, editor, learning review, and mentor controls |
| `static/mentor/app.js` | Browser requests, rendering, local draft saving, and button handlers |
| `static/mentor/dashboard.css` | Dashboard styles |
| `static/js/app.js`, `static/css/app.css` | Shared navigation and page styles |

Read `mentor/urls.py`, then the matching function in `mentor/views.py`, then its service or model. This follows the same path as a user request.

### Example: loading Two Sum

1. The browser sends `GET /api/problem/?identifier=two-sum`.
2. `problem_lookup()` calls `leetcode_service.get_problem()`.
3. The service resolves the slug and checks its in-memory cache.
4. If needed, it requests LeetCode GraphQL data and converts the HTML into plain text and example cards.
5. `ProblemContext.to_dict()` supplies the browser's JSON field names.
6. The browser renders the result and restores that problem's saved code draft.

### Example: asking for a hint

1. The browser sends the problem, code, language, question, and hint level to `/api/assistant/`.
2. The view checks JSON and request size, then applies the request limit.
3. `AIService` validates the fields and builds the prompt using `prompts.py`.
4. Groq returns the mentor answer. Limited local guidance is used if available when the provider fails.
5. Django returns JSON and the browser displays the answer in the mentor dialog.

### Study records and sessions

`StudyRecord` has one row per browser session and problem slug. The view always filters by the server-managed session key, so a client cannot choose another user's records. Saving a solved, optimized, or mastered problem creates its first review date. Marking a review complete advances the schedule inside a database transaction. An expected stage prevents the same review from being advanced twice by a stale request.

Code drafts and focus notes live in browser local storage. Learning reviews live in SQLite locally or PostgreSQL when `DATABASE_URL` is configured. Clearing browser data can remove drafts and access to the anonymous study session. There is no student account system.

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/` | GET | Dashboard |
| `/api/health/` | GET | Lightweight readiness response |
| `/api/daily/` | GET | Daily challenge |
| `/api/problem/?identifier=...` | GET | Problem lookup |
| `/api/study/?problem_slug=...` | GET | Session's study record and revision queue |
| `/api/study/` | POST | Save a checkpoint or mark it reviewed |
| `/api/assistant/` | POST | Mentor response |

POST requests require Django's CSRF token. The assistant allows 20 requests per five minutes by default; change `ASSISTANT_RATE_LIMIT` to adjust this. The limiter and problem cache are in memory and separate in each server process.

## Checks

```bash
python manage.py test
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py collectstatic --noinput
```

Tests mock external providers so they can run without network access or an API key. They use a separate test database.

## Deployment

`render.yaml`, `build.sh`, and `Procfile` configure the Django deployment. The existing `Dockerfile` is an alternative deployment entry point. Production requires `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, allowed hosts, and `GROQ_API_KEY`. `DATABASE_URL` enables PostgreSQL; otherwise Django uses SQLite. WhiteNoise serves collected static files.

The Render build attempts migrations but permits deployment if the optional database is unavailable. In that situation, problem lookup and mentor requests can still work, but learning reviews require a healthy database and successful migrations. The health endpoint does not test database or external-provider availability.

The Docker build needs a temporary `DJANGO_SECRET_KEY` for static collection; provide real production settings when running the container. For example:

```bash
docker build -t leetmentor .
docker run --env-file .env -p 8000:8000 leetmentor
```

The container runs migrations at startup; mount persistent storage for SQLite or configure PostgreSQL to retain learning reviews across container replacement.
