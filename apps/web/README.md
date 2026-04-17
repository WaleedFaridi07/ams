# AMS Web App

React + Vite frontend for Agent Management Studio.

## Main UI Capabilities

- Agent grid with creation timestamp sorting
- Create Agent modal
  - prompt draft generation support
  - file upload support
  - MCP URL + secret support
  - parent child-agent selection
- Chat modal with:
  - retrieval-aware responses
  - feedback scoring (`👍` / `👎`)
  - delegation visibility for parent/child orchestration
- Agent Feedback modal:
  - positive rate and vote counts
  - LLM judge average and count
- Live search on main page:
  - searches name, description, goal, system prompt, child agent names
  - URL persistence via `?q=`
  - `/` keyboard shortcut to focus search input

## Local Dev

```bash
npm run dev -w apps/web
```

If needed, set API base URL:

```bash
VITE_API_BASE_URL=http://localhost:3001
```

## Build

```bash
npm run build -w apps/web
```
