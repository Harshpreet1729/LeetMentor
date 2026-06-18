# LeetMentor

LeetMentor is a local LeetCode practice workspace built for guided learning, not answer vending.

Live website:

- [https://leetmentor-1ya8.onrender.com](https://leetmentor-1ya8.onrender.com)

Instead of copying a problem into a chatbot, waiting for a long reply, and pasting code back into LeetCode, the product keeps the full study loop in one place:

- load a problem
- think first
- write your own attempt
- ask for the smallest useful kind of help
- iterate until you understand the pattern

## What It Is

LeetMentor currently has two surfaces:

- a Django web dashboard for a full-screen coding workspace
- a Chrome extension sidebar for in-context practice on the LeetCode page

The core assistant can:

- explain a problem in simpler terms
- give progressive hints
- review your code
- discuss complexity
- run through samples
- compare approaches
- provide a full solution when you explicitly want one

## Learning Model

The product is designed around four learning principles:

1. Productive struggle matters.
   A small amount of difficulty is useful because it forces pattern recognition, recall, and decision-making.

2. Help should be progressive.
   A directional nudge is better than a complete answer when the student is still capable of solving the problem.

3. Review beats replacement.
   Debugging your own attempt teaches more than reading a fresh solution from scratch.

4. Full solutions should come late.
   The clean solution is most valuable after the student has already formed and tested a mental model.

## Why It Exists

```mermaid
flowchart LR
    subgraph A["Typical copy-paste AI loop"]
        A1["Open LeetCode"]
        A2["Copy the full problem"]
        A3["Paste into chatbot"]
        A4["Paste your code"]
        A5["Read a long answer"]
        A6["Copy the final code back"]
        A1 --> A2 --> A3 --> A4 --> A5 --> A6
    end

    subgraph B["LeetMentor learning loop"]
        B1["Load problem locally"]
        B2["Write your own attempt"]
        B3["Ask for the exact kind of help you need"]
        B4["Revise, test, and understand"]
        B5["Submit with clearer reasoning"]
        B1 --> B2 --> B3 --> B4 --> B5
    end
```

The difference is not only convenience. It changes the user's behavior:

- less tab switching
- less context loss
- less temptation to jump straight to the final code
- more repetition of the actual interview skill loop

## Core Study Loop

```mermaid
flowchart TD
    A["Load problem"] --> B["Read goal, examples, constraints"]
    B --> C["Think before asking"]
    C --> D["Write first attempt"]
    D --> E{"What do you need next?"}
    E -->|"Need a start"| F["Hint"]
    E -->|"Need clarity"| G["Explain"]
    E -->|"Code is failing"| H["Review my code"]
    E -->|"Code works but may be slow"| I["Complexity / Optimize"]
    E -->|"Need a final reference"| J["Full solution"]
    F --> K["Update your approach"]
    G --> K
    H --> K
    I --> K
    K --> D
    J --> L["Compare with your own version"]
    L --> M["Submit and reflect"]
    D --> M
```

## Mentor Actions Explained

Each action exists for a different stage of the learning process.

```mermaid
flowchart LR
    A["Blocked before coding"] --> B["Hint"]
    C["Confused about what the statement means"] --> D["Explain"]
    E["Have code, but it fails"] --> F["Review my code"]
    G["Have code, but unsure about efficiency"] --> H["Complexity"]
    I["Accepted but want a stronger approach"] --> J["Optimize"]
    K["Want to understand sample transitions"] --> L["Dry run"]
    M["Need a final reference after trying"] --> N["Full solution"]
```

### Hint

Use hint mode when you still want to solve the problem yourself.

The ideal hint system is progressive:

- level 1 should help you start
- level 2 should guide the decision flow
- level 3 should describe the solving algorithm without dumping full code

### Explain, Review, and Full Solution

- `Explain` is for understanding the statement, rules, and tricky wording.
- `Review my code` is the highest-leverage mode because it improves your own reasoning instead of replacing it.
- `Complexity`, `Optimize`, and `Dry run` help when your idea exists but needs sharpening.
- `Full solution` is best used last, after you already tried and want a clean reference.

## System Architecture

```mermaid
flowchart TB
    U["User"] --> W["Django web dashboard"]
    U --> X["Chrome extension sidebar"]

    W --> M["Mentor service (Django)"]
    X --> S["Express assistant server"]

    M --> L["LeetCode GraphQL / problem data"]
    S --> L

    M --> G["Groq API"]
    S --> G

    X --> P["Shared package: types, constants, API contract"]
    S --> P
```

## Request Lifecycle

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Workspace
    participant LC as LeetCode data layer
    participant AI as Mentor model

    U->>UI: Load problem
    UI->>LC: Resolve number, slug, title, or URL
    LC-->>UI: Statement, examples, constraints, tags
    U->>UI: Write code and choose an action
    UI->>AI: Send mode + problem context + optional code
    AI-->>UI: Structured answer
    UI-->>U: Render hint, explanation, review, or complexity output
```

## Workspace Shape

The web dashboard is designed as a three-zone study surface:

- left rail for problem context
- center for the code editor
- right rail for mentor actions and responses

```mermaid
flowchart LR
    A["Problem loader<br/>title, difficulty, tags, examples"] --> B["Code workspace<br/>editor, language, hint level"]
    B --> C["Mentor rail<br/>actions, output, next step"]
```

The extension serves a different purpose. It is meant to stay close to the live LeetCode page and provide:

- quick action access
- live code pickup
- compact mentor responses
- a lower-friction debugging loop

## Repository Map

```mermaid
flowchart TD
    A["manage.py"] --> B["leetcode_mentor_project/"]
    B --> C["mentor/"]
    C --> D["views.py, services.py, urls.py"]
    C --> E["templates/mentor/"]
    C --> F["static/mentor/"]

    G["apps/server/"] --> H["Express API for extension"]
    I["apps/extension/"] --> J["Chrome extension UI"]
    K["packages/shared/"] --> L["Shared types and constants"]

    H --> K
    I --> K
```

## Setup

### 1. Python workspace

Install dependencies:

```bash
pip install -r requirements.txt
```

Create a `.env` file:

```env
DJANGO_SECRET_KEY=replace_me
DJANGO_DEBUG=true
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
GROQ_API_KEY=your_groq_api_key_here
AI_MODEL=llama-3.3-70b-versatile
LEETCODE_GRAPHQL_URL=https://leetcode.com/graphql
```

Run migrations and start the Django app:

```bash
python manage.py migrate
python manage.py runserver
```

Open:

```text
http://127.0.0.1:8000
```

### 2. Node workspace for the extension backend

Install dependencies:

```bash
npm install
```

Start the extension API server:

```bash
npm run dev:server
```

This runs the assistant backend used by the Chrome extension on:

```text
http://localhost:4000
```

### 3. Extension build

Build the extension workspace:

```bash
npm run dev:extension
```

## API Requirement

The project expects your own Groq API key. It does not ship with a built-in hosted AI plan.

You need:

- a Groq account
- a `GROQ_API_KEY`
- an `AI_MODEL` value

Without that key, rich mentor responses will be limited or unavailable depending on the surface.

## Recommended Usage Pattern

```mermaid
flowchart TD
    A["Load problem"] --> B["Think for a few minutes first"]
    B --> C["Write a rough attempt"]
    C --> D{"Still blocked?"}
    D -->|"Need a starting push"| E["Hint"]
    D -->|"Statement is unclear"| F["Explain"]
    D -->|"Bug in my code"| G["Review my code"]
    D -->|"Need efficiency check"| H["Complexity / Optimize"]
    D -->|"Need walkthrough"| I["Dry run"]
    D -->|"Need final reference"| J["Full solution"]
    E --> C
    F --> C
    G --> C
    H --> C
    I --> C
    J --> K["Compare, then rewrite in your own words"]
```

## Current Stack

- Django for the local web app
- Express for the extension backend
- React in the extension UI
- Groq API for mentor responses
- LeetCode GraphQL for problem data
- SQLite for local Django persistence
- MathJax for LaTeX rendering in formatted mentor output

## Near-Term Improvements

```mermaid
flowchart LR
    A["Current product"] --> B["Consistent 3-level hint ladder"]
    A --> C["Better extension compact mode"]
    A --> D["Saved sessions and history pruning"]
    A --> E["Stronger language-specific review"]
    A --> F["Monaco editor integration"]
    A --> G["Test coverage"]
    A --> H["Optional deployed backend"]
```

## Deploying The Django App

The easiest first deployment target is the Django dashboard.

This repository is now set up for production-style deployment with:

- `gunicorn` as the app server
- `whitenoise` for static file serving
- optional `DATABASE_URL` support for PostgreSQL
- a `build.sh` build script
- a `render.yaml` blueprint for Render

### Recommended first path: Render

1. Push the repository to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Add the missing secret:

```text
GROQ_API_KEY
```

4. Deploy.

Current live deployment:

- [https://leetmentor-1ya8.onrender.com](https://leetmentor-1ya8.onrender.com)

The included blueprint creates:

- one Python web service
- one PostgreSQL database

### Important production environment variables

Set these in the hosting dashboard, not in source control:

```env
DJANGO_DEBUG=false
DJANGO_SECRET_KEY=generate_a_new_production_secret
GROQ_API_KEY=your_real_groq_key
AI_MODEL=llama-3.3-70b-versatile
```

`DATABASE_URL` is supplied automatically by Render when you use the included `render.yaml`.

### Manual deploy commands

Build command:

```bash
./build.sh
```

Start command:

```bash
gunicorn leetcode_mentor_project.wsgi:application --bind 0.0.0.0:$PORT
```

### Extension note

The Chrome extension backend is separate from the Django dashboard. You can deploy the Django app first and deploy the Node extension API later as a second service if you want the full extension setup online too.

## Bottom Line

LeetMentor is not meant to be a generic chatbot wrapped around LeetCode. It is meant to be a practice environment where you can think, code, ask for targeted help, and build actual problem-solving skill without leaving the workflow.
