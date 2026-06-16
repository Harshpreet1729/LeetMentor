# LeetMentor



LeetMentor is a local LeetCode workflow assistant. The point is not to dump a problem into ChatGPT, wait for a giant answer, and copy the final code back. The point is to stay inside one workspace, ask for only the help you need, and understand the pattern through hints, review, complexity, and optimization.

## Core Workflow

```mermaid
flowchart LR
    A[Open LeetMentor] --> B[Load LeetCode problem]
    B --> C[Read problem statement locally]
    C --> D[Write your own attempt]
    D --> E{What do you need next?}
    E -->|Small push| F[Hint]
    E -->|Problem understanding| G[Explain]
    E -->|Bug hunting| H[Review my code]
    E -->|Performance check| I[Complexity]
    E -->|Make it better| J[Optimize]
    E -->|Need final reference| K[Full solution]
    F --> L[Iterate on your own code]
    G --> L
    H --> L
    I --> L
    J --> L
    K --> M[Compare and learn]
    L --> N[Submit on LeetCode]
    M --> N
```

## Why This Exists

```mermaid
flowchart TB
    subgraph Old_Flow["Copy-paste AI flow"]
        A1[Open LeetCode] --> A2[Copy problem]
        A2 --> A3[Paste into ChatGPT]
        A3 --> A4[Copy your code]
        A4 --> A5[Paste again]
        A5 --> A6[Read long answer]
        A6 --> A7[Copy AI code back]
    end

    subgraph New_Flow["LeetMentor flow"]
        B1[Load problem] --> B2[Code locally]
        B2 --> B3[Ask for exact help]
        B3 --> B4[Learn through hints, review, and optimization]
        B4 --> B5[Submit with understanding]
    end
```

Short version:

- less tab switching
- less copy-paste friction
- more learning from your own attempt
- easier use of hints instead of instant full answers

## Mentor Decision Tree

```mermaid
flowchart TD
    A[You are stuck] --> B{What kind of stuck?}
    B -->|I do not know how to start| C[Hint]
    B -->|I do not understand the problem| D[Explain]
    B -->|My code is wrong| E[Review my code]
    B -->|My code works but feels slow| F[Complexity]
    B -->|I want a better approach| G[Optimize]
    B -->|I want to compare with a clean answer| H[Full solution]
```

## Request Flow

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Django UI
    participant LS as LeetCode Service
    participant AI as Groq API

    U->>UI: Load problem / write code / choose action
    UI->>LS: Fetch problem by number, slug, title, or URL
    LS-->>UI: Problem statement, examples, constraints, tags
    U->>UI: Ask for hint / review / optimize / solution
    UI->>AI: Send problem context + code + mode
    AI-->>UI: Structured answer with code blocks and LaTeX
    UI-->>U: Render response in one workspace
```

## Product Shape

```mermaid
flowchart LR
    A[Problem loader] --> B[Workspace editor]
    B --> C[Mentor actions]
    C --> D[Structured response renderer]
    D --> E[Hints]
    D --> F[Code review]
    D --> G[Complexity in LaTeX]
    D --> H[Formatted code blocks]
```

## What The App Does

```mermaid
mindmap
  root((LeetMentor))
    Problem Input
      Daily challenge
      Problem number
      Title slug
      Full LeetCode URL
    Coding
      C++
      Python
      Java
      JavaScript
    Mentor Modes
      Hint
      Explain
      Review my code
      Complexity
      Dry run
      Optimize
      Full solution
    Output Style
      LaTeX for maths
      Code fences
      Compact sections
      One-page workflow
```

## API Requirement

```mermaid
flowchart TD
    A[LeetMentor starts] --> B{Do you have a Groq API key?}
    B -->|Yes| C[Set GROQ_API_KEY in .env]
    C --> D[AI features work]
    B -->|No| E[Advanced AI responses cannot run properly]
```

This project needs your own API key. It does not include a built-in unlimited AI service.

You need:

- a Groq account
- a `GROQ_API_KEY`
- an `AI_MODEL` value

## Setup

```mermaid
flowchart LR
    A[Clone repo] --> B[Create .env]
    B --> C[Add Django settings]
    C --> D[Add GROQ_API_KEY]
    D --> E[Run migrations]
    E --> F[Start server]
    F --> G[Open localhost:8000]
```

Use this `.env`:

```env
DJANGO_SECRET_KEY=replace_me
DJANGO_DEBUG=true
DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost
GROQ_API_KEY=your_groq_api_key_here
AI_MODEL=llama-3.3-70b-versatile
LEETCODE_GRAPHQL_URL=https://leetcode.com/graphql
```

Run:

```bash
python manage.py migrate
python manage.py runserver
```

Open:

```text
http://127.0.0.1:8000
```

## Recommended Usage Pattern

```mermaid
flowchart TD
    A[Load a problem] --> B[Think first]
    B --> C[Write your own attempt]
    C --> D{Need help?}
    D -->|Yes, but not full code| E[Use Hint]
    D -->|My code is failing| F[Use Review my code]
    D -->|I want better performance| G[Use Complexity or Optimize]
    D -->|I want a clean reference answer| H[Use Full solution last]
    E --> C
    F --> C
    G --> C
    H --> I[Compare with your version]
```

## Repository Map

```mermaid
flowchart TB
    A[manage.py]
    B[leetcode_mentor_project/]
    C[mentor/]
    D[templates/mentor/]
    E[static/mentor/]
    F[apps/server/]
    G[apps/extension/]
    H[packages/shared/]

    A --> B
    B --> C
    C --> D
    C --> E
    C -. legacy support .-> F
    F -. shared types .-> H
    G -. shared types .-> H
```

## Practical Theory

LeetMentor is best when you use it like a study partner, not like a code vending machine.

- `Hint` is for momentum.
- `Review my code` is for debugging your own logic.
- `Complexity` and `Optimize` are for pushing from accepted to strong.
- `Full solution` is most useful after you already tried.

If you skip straight to the final solution every time, you will finish problems. If you loop through hints, review, and optimization, you will build actual interview skill.

## Current Stack

- Django backend and UI
- Groq API for AI responses
- LeetCode GraphQL for problem data
- SQLite locally
- LaTeX rendering through MathJax

## Good Next Improvements

```mermaid
flowchart LR
    A[Current app] --> B[Monaco editor]
    A --> C[Saved sessions]
    A --> D[User auth]
    A --> E[Postgres for deployment]
    A --> F[Better language-specific review]
    A --> G[Test coverage]
```
