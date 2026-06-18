# LeetMentor

LeetMentor is a local LeetCode practice workspace built for guided learning, not answer vending.

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

## Product Thesis

Most AI-assisted coding flows remove the exact friction that helps people learn.

That sounds convenient, but it often trains the wrong behavior:

- ask too early
- read passively
- trust the answer before testing your own reasoning
- optimize for completion instead of understanding

LeetMentor is based on a different idea: the tool should support the student's reasoning, not replace it.

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

### Explain

Use explain mode when the statement itself is the blocker.

This is for:

- understanding the real goal
- clarifying rules
- unpacking tricky wording
- reading a smaller example in plain language

### Review My Code

Use review mode after you have an honest attempt.

This is the highest-leverage mode for learning because it forces the assistant to work on your reasoning instead of replacing it.

### Complexity

Use complexity mode when your logic works but you want to know whether it is strong enough for interviews or large inputs.

### Optimize

Use optimize mode when you want to improve the accepted version into a cleaner or more efficient one.

### Dry Run

Use dry run mode when you know the broad idea but lose track of state changes, pointer moves, or transitions.

### Full Solution

Use the full solution last, not first.

It is most useful when:

- you already tried
- you want to compare structure
- you want to confirm the standard accepted pattern

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

## Practical Theory

LeetMentor works best when it behaves like a disciplined mentor:

- it should not rescue too early
- it should not confuse verbosity with usefulness
- it should push the student back into active reasoning
- it should make code review and reflection easier than blind copying

The product becomes valuable when the student repeatedly experiences this loop:

1. form an idea
2. test it in code
3. notice the gap
4. ask for a targeted nudge
5. revise the mental model

That loop is where interview skill is actually built.

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

## Bottom Line

LeetMentor is not trying to be a generic chatbot wrapped around LeetCode.

It is trying to be a better practice environment:

- one place to think
- one place to code
- one place to ask for help
- one place to build actual problem-solving skill
