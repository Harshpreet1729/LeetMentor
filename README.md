<p align="center">
  <img src="static/brand/leetmentor-mark.svg" alt="LeetMentor logo" width="72" />
</p>

<h1 align="center">LeetMentor</h1>

<p align="center">
  Guided LeetCode practice for people who want to learn the pattern, not just copy the answer.
</p>

<p align="center">
  <a href="https://leetmentor-1ya8.onrender.com">Live demo</a> |
  <a href="#architecture">Architecture</a> |
  <a href="#data-flow">Data Flow</a> |
  <a href="#local-setup">Local Setup</a>
</p>

<p align="center">
  <img alt="Django" src="https://img.shields.io/badge/Django-Web%20workspace-113228?style=for-the-badge" />
  <img alt="React" src="https://img.shields.io/badge/React-Extension%20UI-0F172A?style=for-the-badge" />
  <img alt="Express" src="https://img.shields.io/badge/Express-Extension%20API-111827?style=for-the-badge" />
  <img alt="Groq" src="https://img.shields.io/badge/Groq-AI%20responses-0B3B2E?style=for-the-badge" />
</p>

## Overview

LeetMentor keeps the full problem-solving loop in one workspace:

- load a LeetCode problem
- think before asking for help
- write your own attempt
- request the smallest useful intervention
- revise until the pattern clicks

It currently ships in two surfaces that share the same teaching philosophy:

| Surface | Best for | Main stack |
| --- | --- | --- |
| Web dashboard | Full-screen study sessions with problem, code, and mentor output side by side | Django, HTML, CSS, JS |
| Chrome extension | In-context practice directly on the LeetCode page | React, TypeScript, Express |

Both surfaces now keep drafts scoped to the current problem and language. The extension also keeps a capped chat history per problem, while the web dashboard supports focused questions, copyable mentor output, and `Ctrl`/`⌘` + `Enter` shortcuts.

The Django dashboard also includes a session-scoped Learning Review System: students save their progress checkpoint, confidence, main mistake, and reflection for each problem. Solved problems automatically enter a spaced revision queue scheduled after 1, 3, 7, 21, and 45 days.

## Why This Exists

```mermaid
flowchart LR
    subgraph Old["Typical copy-paste AI loop"]
        A1["Open LeetCode"]
        A2["Copy the full prompt"]
        A3["Paste into chatbot"]
        A4["Read a big answer"]
        A5["Paste code back"]
        A1 --> A2 --> A3 --> A4 --> A5
    end

    subgraph New["LeetMentor learning loop"]
        B1["Load problem"]
        B2["Think first"]
        B3["Write attempt"]
        B4["Ask for targeted help"]
        B5["Refine and submit"]
        B1 --> B2 --> B3 --> B4 --> B5
    end

    classDef old fill:#1f2937,stroke:#475569,color:#e5e7eb,stroke-width:1px;
    classDef mentor fill:#0f3d2e,stroke:#34d399,color:#ecfdf5,stroke-width:1px;
    class A1,A2,A3,A4,A5 old;
    class B1,B2,B3,B4,B5 mentor;
```

The point is not just convenience. The product is trying to preserve productive struggle, reduce context switching, and make hints feel like coaching instead of answer vending.

## Experience Model

### Mentor Actions

| Action | When to use it | What it should do |
| --- | --- | --- |
| `Hint` | You are blocked but still want to solve it yourself | Nudge the next move without dumping code |
| `Explain` | The statement or constraints are unclear | Rephrase the task in simpler words |
| `Review my code` | You already wrote an attempt | Find the exact bug or reasoning mistake |
| `Complexity` | Your code works, but you doubt the efficiency | Compare current vs target complexity |
| `Optimize` | You want the better pattern | Explain the upgrade path |
| `Dry run` | You need to see state changes on real input | Walk through one example clearly |
| `Full solution` | You already tried and now want a clean reference | Show the optimal approach last |

### Study Loop

```mermaid
flowchart TD
    A["Load problem"] --> B["Read goal, examples, constraints"]
    B --> C["Think before asking"]
    C --> D["Write first attempt"]
    D --> E{"What help do I need?"}
    E -->|"Need a nudge"| F["Hint"]
    E -->|"Need clarity"| G["Explain"]
    E -->|"My code fails"| H["Review my code"]
    E -->|"I need speed"| I["Complexity / Optimize"]
    E -->|"Need a reference"| J["Full solution"]
    F --> K["Revise approach"]
    G --> K
    H --> K
    I --> K
    K --> D
    J --> L["Compare, then rewrite in your own words"]

    classDef step fill:#0f172a,stroke:#334155,color:#f8fafc;
    classDef choice fill:#3b2f0c,stroke:#f59e0b,color:#fef3c7;
    classDef action fill:#082f49,stroke:#38bdf8,color:#e0f2fe;
    class A,B,C,D,K,L step;
    class E choice;
    class F,G,H,I,J action;
```

### Learning Review Loop

1. Load a problem and make an honest attempt.
2. Save the current checkpoint, confidence, and main mistake.
3. Write one short reflection about what to try first next time.
4. Once the problem is solved, revisit it from the revision queue.
5. Mark the revision complete to schedule the next interval.

Learning records are stored by Django and isolated to the anonymous browser session. No account is required for local practice.

## Architecture

LeetMentor is one product with two delivery surfaces:

- the Django app is the standalone study dashboard
- the extension stack is a React sidebar plus a local Express API
- both surfaces fetch LeetCode problem data and generate mentor responses

```mermaid
flowchart TB
    U["User"]

    subgraph Surface["User-facing surfaces"]
        W["Django dashboard"]
        X["Chrome extension sidebar"]
    end

    subgraph Services["Application services"]
        M["mentor/views.py + mentor/services.py"]
        S["apps/server/src/index.ts"]
        P["packages/shared<br/>types + constants"]
    end

    subgraph External["External providers"]
        L["LeetCode GraphQL + problem index"]
        G["Groq Chat Completions API"]
    end

    U --> W
    U --> X

    W --> M
    X --> S
    X -. shares contracts .-> P
    S -. shares contracts .-> P

    M --> L
    M --> G
    S --> L
    S --> G

    classDef surface fill:#0f172a,stroke:#64748b,color:#f8fafc;
    classDef service fill:#0f3d2e,stroke:#34d399,color:#ecfdf5;
    classDef external fill:#3f1d2e,stroke:#fb7185,color:#fff1f2;
    class U,W,X surface;
    class M,S,P service;
    class L,G external;
```

## Data Flow

### Web Dashboard Request Flow

```mermaid
sequenceDiagram
    participant User
    participant Web as Django dashboard
    participant Views as mentor/views.py
    participant Service as mentor/services.py
    participant LC as LeetCode
    participant AI as Groq

    User->>Web: Load problem / choose mentor action
    Web->>Views: /api/problem or /api/assistant
    Views->>Service: Resolve problem or generate response
    Service->>LC: Fetch statement, examples, constraints
    Service->>AI: Generate hint, explanation, review, or solution
    AI-->>Service: Structured markdown answer
    Service-->>Views: JSON payload
    Views-->>Web: Render response in mentor output panel
```

### Extension Request Flow

```mermaid
sequenceDiagram
    participant User
    participant Page as LeetCode page
    participant CS as contentScript.tsx
    participant BG as background.ts
    participant API as Express API
    participant LC as LeetCode
    participant AI as Groq

    User->>Page: Open a problem
    CS->>Page: Extract title, slug, code, language
    User->>CS: Open sidebar and pick an action
    CS->>BG: Send runtime API request
    BG->>API: Forward /api/assistant or /api/leetcode/*
    API->>LC: Fetch problem metadata when needed
    API->>AI: Generate mentor response
    API-->>BG: JSON response
    BG-->>CS: Return result
    CS-->>User: Render hint, review, or walkthrough
```

### Runtime Boundaries

```mermaid
flowchart LR
    A["Browser page DOM"] --> B["Extension content script"]
    B --> C["Extension background worker"]
    C --> D["Local Express API :4000"]
    D --> E["Groq API"]
    D --> F["LeetCode endpoints"]

    classDef local fill:#111827,stroke:#4b5563,color:#f9fafb;
    classDef remote fill:#3f1d2e,stroke:#fb7185,color:#fff1f2;
    class A,B,C,D local;
    class E,F remote;
```

## Repository Layout

```mermaid
flowchart TD
    A["manage.py"] --> B["leetcode_mentor_project/"]
    B --> C["mentor/"]
    C --> D["views.py<br/>services.py<br/>urls.py"]
    C --> E["templates/mentor/"]
    C --> F["static/mentor/"]

    G["apps/server/"] --> H["Express API for extension"]
    I["apps/extension/"] --> J["React sidebar, content script, background worker"]
    K["packages/shared/"] --> L["Shared TS types and constants"]

    H --> K
    I --> K

    classDef node fill:#0f172a,stroke:#64748b,color:#f8fafc;
    class A,B,C,D,E,F,G,H,I,J,K,L node;
```

## Local Setup

### 1. Python workspace

```bash
pip install -r requirements.txt
```

Create a `.env` file in the repo root:

```env
DJANGO_SECRET_KEY=replace_me
DJANGO_DEBUG=true
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
GROQ_API_KEY=your_groq_api_key_here
AI_MODEL=llama-3.3-70b-versatile
LEETCODE_GRAPHQL_URL=https://leetcode.com/graphql
```

Run the Django app:

```bash
python manage.py migrate
python manage.py runserver
```

Open `http://127.0.0.1:8000`.

### 2. Node workspaces

Install dependencies for the extension stack:

```bash
npm install
```

Start the local API used by the Chrome extension:

```bash
npm run dev:server
```

This serves the extension backend at `http://localhost:4000`.

The server binds to `127.0.0.1` by default. Set `HOST` only when you intentionally need another interface, and use a comma-separated `CORS_ORIGIN` allowlist for any non-local web clients. Chrome extension origins and local development origins are handled automatically.

### 3. Extension build

Run the extension dev build:

```bash
npm run dev:extension
```

## API Surfaces

### Django app

| Route | Purpose |
| --- | --- |
| `/api/health/` | Health check |
| `/api/daily/` | Fetch the daily challenge |
| `/api/problem/?identifier=...` | Resolve a problem by number, slug, title, or URL |
| `/api/study/` | Save a learning review or load the session revision queue |
| `/api/assistant/` | Generate mentor output for the web dashboard |

### Extension API

| Route | Purpose |
| --- | --- |
| `/api/leetcode/daily` | Daily challenge for the extension |
| `/api/leetcode/problem/:identifier` | Problem lookup for the extension |
| `/api/assistant/chat` | Mentor chat endpoint for the sidebar |

## Environment Notes

- `GROQ_API_KEY` is required for rich AI-generated responses.
- Without that key, some local fallback logic still helps with hints or guardrails, but the full mentor experience is limited.
- `AI_MODEL` defaults to `llama-3.3-70b-versatile`.
- The extension and the Django dashboard are separate runtimes, so deploying the web app does not automatically deploy the extension backend.
- `ASSISTANT_RATE_LIMIT` controls the Django dashboard's per-session request allowance (default: 20 requests per five minutes).
- Invalid modes, oversized payloads, malformed provider data, and untrusted browser origins are rejected before they can reach the AI provider.

## Verification

Run the full local verification set with:

```bash
npm run typecheck
npm run build
python manage.py test
python manage.py check
```

The Django suite covers endpoint validation, rate limiting, problem parsing, and safe offline guidance. The TypeScript build validates the server, shared contracts, popup/options UI, and loadable extension content-script bundle.

## Deployment

The repository already includes production-oriented Django deployment pieces:

- `gunicorn` as the app server
- `whitenoise` for static assets
- optional `DATABASE_URL` support
- `build.sh` for build steps
- `render.yaml` for a Render blueprint

### Recommended path: Render

1. Push the repository to GitHub.
2. Create a new Blueprint in Render from the repo.
3. Add the missing secret: `GROQ_API_KEY`.
4. Deploy.

The included blueprint provisions:

- one Python web service
- one PostgreSQL database

Important production variables:

```env
DJANGO_DEBUG=false
DJANGO_SECRET_KEY=generate_a_new_production_secret
GROQ_API_KEY=your_real_groq_key
AI_MODEL=llama-3.3-70b-versatile
```

`DATABASE_URL` is supplied automatically when you use the included Render blueprint.

Manual commands:

```bash
./build.sh
gunicorn leetcode_mentor_project.wsgi:application --bind 0.0.0.0:$PORT
```

## Current Stack

- Django for the standalone coding workspace
- HTML, CSS, and vanilla JS for the dashboard shell
- React and TypeScript for the Chrome extension UI
- Express for the extension API
- Groq for mentor responses
- LeetCode GraphQL and problem index endpoints for problem data
- SQLite locally, with PostgreSQL support in deployment
- shared TypeScript contracts in `packages/shared`

## Roadmap

```mermaid
flowchart LR
    A["Current foundation"] --> B["Stronger hint ladder"]
    A --> C["Session export and progress summaries"]
    A --> D["Language-aware code review"]
    A --> E["Monaco editor polish"]
    A --> F["More automated tests"]
    A --> G["Optional hosted extension backend"]

    classDef future fill:#172554,stroke:#60a5fa,color:#dbeafe;
    class A,B,C,D,E,F,G future;
```

## Bottom Line

LeetMentor is designed to keep students inside the real interview-prep loop: read, think, code, ask, revise, and understand. The README should reflect that same idea, so the docs now explain both the teaching model and the actual system boundaries clearly enough for a contributor, reviewer, or recruiter to understand the product fast.
