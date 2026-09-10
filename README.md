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

Create a `.env` file in the project folder with these local settings. Keep it private:

```dotenv
DJANGO_DEBUG=true
DJANGO_SECRET_KEY=replace-with-your-own-development-secret
GROQ_API_KEY=your-groq-api-key
```

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
| `mentor/hints.py` | Local hint text grouped by topic and hint level |
| `mentor/models.py` | Store study records and schedule their first review |
| `mentor/migrations/` | Create the database schema; keep these for new installations |
| `mentor/tests.py` | Regression tests for services, endpoints, and study records |
| `templates/base.html` | Shared page layout |
| `templates/mentor/dashboard.html` | Problem loader, editor, learning review, and mentor controls |
| `static/mentor/app.js` | Entry point: connect buttons and restore the workspace |
| `static/mentor/workspace.js` | Page elements, shared state, and small display helpers |
| `static/mentor/problems.js` | Load and display a problem or daily challenge |
| `static/mentor/assistant.js` | Request AI help, manage the response dialog, and open external help |
| `static/mentor/drafts.js` | Save and restore browser drafts and preferences |
| `static/mentor/study.js` | Save learning checkpoints and display the revision queue |
| `static/mentor/api.js` | JSON requests, CSRF headers, timeouts, and server wake retries |
| `static/mentor/rendering.js` | Safely format examples, constraints, and AI responses |
| `static/mentor/dashboard.css` | Dashboard styles |
| `static/js/app.js`, `static/css/app.css` | Shared navigation and page styles |

Read `mentor/urls.py`, then the matching function in `mentor/views.py`, then its service or model. This follows the same path as a user request.

### Backend reading order

1. **`mentor/urls.py` -> `mentor/views.py`**: start with `home`, `problem_lookup`,
   and `assistant_chat`. `_json_payload` checks incoming JSON for both POST endpoints.
2. **`mentor/leetcode.py`**: follow `get_problem` -> `_resolve_slug` ->
   `_graphql_request` -> `_map_question`. `_slug_from_url` extracts a slug from a
   link; `_title_to_slug` cleans a title when lookup cannot find an exact match.
3. **`mentor/services.py`**: follow `generate_assistant_response`. It validates the
   input, asks Groq, uses the existing local fallback when available, and checks the
   answer format. `prompts.py` and `hints.py` contain text, not extra request flows.
4. **`mentor/models.py`**: read the fields, then `review_interval_for_stage` and
   `save`. An existing review date is preserved when you edit a reflection.
5. **`study_records` in `mentor/views.py`**: GET loads progress; POST delegates to
   `_save_study_record` or `_review_study_record`. Both use `_study_response` for
   the same JSON shape. Database transactions, session filters, and stale-review
   checks remain in place.

The earlier PDF shows the original implementations. Use these function names to
find the current code. Explanations now live here rather than in source comments.

### JavaScript reading order

The dashboard loads `app.js` using `<script type="module">`. Each `import` names the
functions a file uses, much like Python imports. The browser loads these files
directly; there is no package installation or JavaScript build step. The parent
template's separate `static/js/app.js` still handles shared navigation.

Read one user action at a time, rather than memorizing every helper:

1. **`workspace.js`**: look at `elements` (HTML elements found by ID) and `state`
   (the current problem, language, and pending requests). Skim the display helpers.
2. **`app.js`**: find the Load button's `addEventListener`. It calls `loadProblem`.
   The final section restores the last workspace when the page opens.
3. **`problems.js`**: follow `loadProblem` -> `loadProblemRequest` ->
   `applyProblemState`. The last function displays the problem, restores its draft,
   and asks `study.js` to load its learning record.
4. **`api.js`**: read `fetchJson` and `postJson`. GET receives data; POST sends an
   object encoded as JSON with a CSRF header. Read wake/retry helpers afterward.
5. **`assistant.js`**: follow `runAssistant`: validate the inputs, build the payload,
   call Django, and display the response. Dialog and external-link helpers are separate.
6. **`drafts.js`**: follow `saveDraftFor` and `restoreDraftFor`. The storage key
   includes the problem slug and language. `restoreWorkspaceSnapshot` returns saved
   problem data to `app.js`; storage code does not load problems itself.
7. **`study.js`**: follow `loadStudyData`, `saveStudyRecord`, and `markStudyReviewed`.
   The version checks ignore old responses after you change the selected problem.
8. **`rendering.js`**: read last. It formats text for display and escapes HTML from
   external content. These formatting details are separate from the request flow.

For each function, answer: who calls it, what enters it, what it does, and what it
returns or changes on the page. A useful first exercise is tracing a hint from the
button in `app.js` to `runAssistant`, `postJson`, Django's `assistant_chat`, and back
to `renderAssistantOutput`.

The earlier PDF describes the pre-refactor JavaScript layout. Most function names
remain the same; use this table to find their new files. The feature logic remains
plain JavaScript; separating it makes the reading path smaller, not the features fewer.

Module imports include a release query string to refresh browser caches. When
changing shared modules for deployment, update that version in the imports and the
dashboard's script tag together, then run `collectstatic`.

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
