# LeetMentor

A small React + Django app for LeetCode practice. Load a daily or chosen problem,
write code, ask for one of three hint levels or a code review, and save your best solution.

## Run locally

Use Python 3.12+ and Node.js 22.12+ (Node 22 LTS or newer).

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
npm ci --prefix frontend
```

Keep your existing `.env`. For a new setup, create `.env` in the project root:

```dotenv
DJANGO_DEBUG=true
DJANGO_SECRET_KEY=replace-with-your-own-development-secret
GROQ_API_KEY=your-groq-api-key
```

Build the frontend, then serve the entire app with Django:

```powershell
npm run build --prefix frontend
python manage.py migrate
python manage.py runserver
```

Open http://localhost:8000/. Rebuild the frontend after changing JSX or CSS.
Node is not needed once the production assets have been built.

For automatic frontend updates, keep Django running on **localhost:8000** in one
terminal and run this in another:

```powershell
npm run dev --prefix frontend
```

Open http://localhost:5173/. Vite proxies API requests and the logo to Django.
It also proxies `/django-csrf` to Django's existing home page to obtain its CSRF
cookie and token. This path exists only in the Vite development proxy; no backend
endpoint or CORS configuration was added. Use `localhost` for both servers.

Alternatively, `npm run build:watch --prefix frontend` rebuilds assets while you
continue using Django at http://localhost:8000/.

## Small frontend structure

```text
frontend/
  package.json          # React/Vite dependencies and commands
  package-lock.json     # Exact dependency versions for reproducible builds
  vite.config.js        # Development proxy and Django static output directory
  index.html            # Vite development entry page
  src/
    main.jsx            # Mount App into the page and import the stylesheet
    App.jsx             # Page layout, state, and button handlers
    api.js              # Fetch JSON with session cookies, CSRF, and a timeout
    Feedback.jsx         # Safely display AI headings, code blocks, and tables
    style.css            # The existing design and responsive layout
```

`templates/mentor/dashboard.html` is the production HTML shell: it supplies the
CSRF token, fonts, logo, root element, and built script/style tags. There is one
frontend implementation. The old vanilla `app.js` and `dashboard.css` were removed;
their styling now lives in `frontend/src/style.css`.

No router, global-state library, UI framework, custom hooks, or TypeScript is used.
`Feedback.jsx` is the only extracted feature component because safe answer
formatting would otherwise distract from the page's request flow. The small
`Status` and `InlineText` helpers remain in the files that use them.

## How to explain it in an interview

> React stores the current problem and code in component state. Button handlers
> send JSON to Django using fetch. Django retrieves problems from LeetCode, asks
> Groq for hints or reviews, and saves my chosen best solutions in the database.
> Vite builds React into static files that Django serves in production.

Read `main.jsx`, then `App.jsx`, then `api.js`. Trace **Get a hint → ask → request →
Django assistant_chat → Groq → setFeedback → React renders the answer**.

The important React concepts are:

- **Components and JSX:** functions describe the page, with props for the feedback renderer.
- **useState:** holds the problem, code, language, hint level, history, feedback,
  loading flag, and messages inside `App`. One page does not need global state.
- **Controlled inputs:** `value` reads state and `onChange` updates it.
- **useEffect:** loads history when the page opens and saves drafts/preferences
  when their state changes. Button requests stay in event handlers.
- **Rendering lists and conditions:** `map` displays examples/history; conditions
  select the empty state, loaded problem, or AI feedback.
- **Async handlers:** await a request, display an error if it fails, and clear the
  loading flag in `finally`. Controls are disabled while a request runs so
  switching problems cannot show a stale response.
- **Safe rendering:** React escapes problem text, code, and AI output. The feedback
  component creates normal React elements; it never inserts raw HTML.

## Django and the API

Backend responsibilities and request formats are unchanged:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/problem/?identifier=...` | GET | Number, title, slug, or LeetCode URL lookup |
| `/api/daily/` | GET | Daily LeetCode challenge |
| `/api/history/` | GET | Browser session's saved solutions |
| `/api/history/` | POST | Save or replace one best solution |
| `/api/assistant/` | POST | Hint (`hintLevel` 1–3) or code review |

`api.js` uses relative URLs and `credentials: "same-origin"`. Browser cookies keep
the existing anonymous Django session. POST requests carry `X-CSRFToken`, obtained
from the Django HTML shell (or from the proxied Django page during Vite development).
Groq keys stay in Django's environment; React never receives them.

The backend still validates requests, enforces its in-process rate limit, and
stores history. Read `mentor/urls.py`, then `mentor/views.py`, then
`mentor/leetcode.py`, `mentor/services.py`, or `mentor/models.py` for each request.

## Drafts and history

Drafts use the same `leetmentor.draft.v2.<problem>.<language>` keys as before.
The last problem snapshot, language, hint preference, and legacy code key are
also preserved. A damaged snapshot is ignored; unavailable localStorage shows
an explanatory message while practice remains usable.

Saving marks a problem solved and replaces its previous best code and language.
You choose which code is best. History can reopen a problem and uses its saved
solution if no draft exists. The app does not run or submit code to LeetCode.

History belongs to an anonymous browser session. Clearing cookies can remove
access to it; clearing localStorage removes drafts. Saved solutions use SQLite
locally or PostgreSQL through `DATABASE_URL`. Old study notes remain in the
archived database table; keep both migrations.

## Checks

```powershell
npm ci --prefix frontend
npm run build --prefix frontend
python manage.py test
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py collectstatic --noinput
```

Build before running Django's frontend asset checks. Tests use a separate
database and mock external APIs. Browser QA should also exercise search/daily,
all hint levels, review, save/replace/reload history, per-language drafts, CSRF,
errors, and disabled controls while a request is pending.

## Production deployment

Railway continues to run a single Django service. The Dockerfile first builds the
frontend in a Node 22 stage. Only the generated files are copied into the Python
runtime stage, then Django `collectstatic` collects and hashes them for WhiteNoise.
The production container runs migrations and Gunicorn using the existing `start.py`.
It does not need a Vite server or a Node runtime.

Vite writes generated assets into ignored `static/mentor/react/`. Stable build
filenames let the Django template use its normal `{% static %}` tags; Django's
manifest storage adds cache hashes in production. Do not edit or commit generated
bundles or `node_modules`. Railway builds the project using the Dockerfile;
the old alternative deployment files have been removed.

Production requires `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, allowed hosts, and
`GROQ_API_KEY`. `AI_MODEL` overrides the default model and is configured separately
in Railway Variables. Use PostgreSQL or persistent SQLite storage for history.
The readiness endpoint does not check external-provider or database availability.
