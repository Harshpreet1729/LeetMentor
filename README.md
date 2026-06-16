# LeetCode Mentor, Django Edition

This project is now pivoted toward a Django-based web app instead of a Chrome extension. The goal stays the same: help you learn LeetCode with directional hints, clean code review, complexity analysis, dry runs, and full solutions when you explicitly ask for them.

## What You Get

- Dark, single-dashboard UI instead of a browser extension
- Problem lookup by number, slug, title, or LeetCode URL
- Daily challenge loader
- Code workspace for C++, Python, Java, and JavaScript
- Mentor actions for explain, hint, review, complexity, dry run, optimize, and full solution
- Gemini-powered responses with short, directional hint mode

## Main Stack

- Backend and UI: Django
- AI: Gemini API
- Problem source: LeetCode GraphQL + problem index fallback
- Database: SQLite

## Project Layout

```text
manage.py
leetcode_mentor_project/   Django project config
mentor/                    Django app with views and services
templates/mentor/          Dashboard template
static/mentor/             Dark UI CSS and client-side JS

apps/extension/            Legacy Chrome extension code
apps/server/               Legacy Node backend code
packages/shared/           Legacy shared TS types
```

## Setup

1. Create a root `.env` file from the example values below.
2. Add your Gemini key.
3. Run migrations.
4. Start Django.

Example `.env`:

```env
DJANGO_SECRET_KEY=replace_me
DJANGO_DEBUG=true
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
GROQ_API_KEY=your_groq_api_key_here
AI_MODEL=llama-3.3-70b-versatile
LEETCODE_GRAPHQL_URL=https://leetcode.com/graphql
```

## Run It

```bash
python manage.py migrate
python manage.py runserver
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## How To Use

1. Load a problem using its number, slug, title, or LeetCode URL.
2. Paste your code into the code studio.
3. Pick your language.
4. Click `Explain Problem`, `Give Hint`, `Review My Code`, `Analyze Complexity`, `Dry Run`, `Optimize`, or `Show Full Solution`.
5. Add an optional question if you want the mentor to focus on something specific.

## Notes

- The old extension code is still present, but it is no longer the primary product path.
- Django will also read env values from `apps/server/.env` if you already placed your Gemini key there.
- Hint mode is intentionally short so it does not waste tokens.

## Next Good Improvements

- Add Monaco Editor for a stronger VS Code-like editing feel
- Save past sessions to the database
- Add authentication so each user keeps their own history
- Add pattern-based hinting before calling Gemini
