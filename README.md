# LeetMentor

LeetMentor is a local LeetCode study workspace.

The main idea is simple: when you are solving LeetCode, you should not have to keep copy-pasting the problem into ChatGPT, then copy-pasting your code, then copy-pasting the answer back into your editor. That flow is slow, distracting, and honestly makes it too easy to jump straight to the final code without understanding the idea.

This project keeps everything in one place:

- load the LeetCode problem directly
- write your code in the same workspace
- ask for a hint instead of a full answer
- review your code without leaving the page
- understand complexity, dry runs, and optimizations
- only ask for a full solution when you really want it

So the goal is not just "get accepted". The goal is to actually learn the pattern, debug your own thinking, and stop treating AI like a copy-paste answer machine.

## Why Use This

Normal workflow:

1. open LeetCode
2. copy the problem
3. paste it into ChatGPT
4. copy your code
5. paste your code too
6. read a huge answer
7. copy the AI code back again

LeetMentor workflow:

1. load the problem
2. write your code
3. ask for exactly what you need:
   - hint
   - explanation
   - review my code
   - complexity
   - optimize
   - dry run
   - full solution

That means less friction, less noise, and a better chance that you actually understand what you are doing.

## What It Does

- Problem lookup by LeetCode number, slug, title, or URL
- Daily challenge loader
- Local coding workspace for `C++`, `Python`, `Java`, and `JavaScript`
- Focused mentor actions:
  - `Hint`
  - `Explain the problem`
  - `Review my code`
  - `Complexity`
  - `Dry run`
  - `Optimize`
  - `Full solution`
- Structured AI responses with code blocks and LaTeX for maths/complexity where needed
- Clean single-page UI instead of bouncing between tools

## You Need An API Key

This app does **not** ship with a free built-in AI backend.

You need your own API key to use the AI features.

Right now the app is configured to use **Groq**. So you need:

- a Groq account
- a Groq API key

Without that key, the advanced AI responses will not work properly.

## Tech Stack

- Backend: Django
- Frontend: Django templates + vanilla JS + CSS
- AI provider: Groq API
- Problem source: LeetCode GraphQL
- Local DB: SQLite

## Setup

Create a root `.env` file like this:

```env
DJANGO_SECRET_KEY=replace_me
DJANGO_DEBUG=true
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
GROQ_API_KEY=your_groq_api_key_here
AI_MODEL=llama-3.3-70b-versatile
LEETCODE_GRAPHQL_URL=https://leetcode.com/graphql
```

Then run:

```bash
python manage.py migrate
python manage.py runserver
```

Open:

```text
http://127.0.0.1:8000
```

## How To Use It Well

Best way to use this project:

1. load the problem
2. think first
3. write your own attempt
4. ask for a `Hint` if stuck
5. use `Review my code` when your logic is failing
6. use `Complexity` and `Optimize` after you have something working
7. use `Full solution` only when you want to compare against a clean final version

If you only use the full-solution button every time, you will get answers.
If you use hints, reviews, and optimizations properly, you will actually get better.

## Project Structure

```text
manage.py
leetcode_mentor_project/   Django project config
mentor/                    Django views and AI/problem services
templates/mentor/          Dashboard templates
static/mentor/             Dashboard JS and CSS

apps/extension/            Older extension code
apps/server/               Older Node backend code
packages/shared/           Shared TS types
```

## Notes

- `.env` is required for AI features
- the Groq model can be changed with `AI_MODEL`
- hint mode is intentionally short so it nudges you instead of solving everything immediately
- the old extension/server folders still exist, but the main experience here is the Django app

## Good Next Improvements

- Monaco editor support
- saved session history
- user login and per-user workspace state
- stronger code review prompts per language
- test coverage for assistant formatting and problem parsing
