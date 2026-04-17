# AMS - Agent Management Studio

AMS is a monorepo demo platform for building and running AI agents.

It includes:
- Agent CRUD with prompt generation support
- File-based knowledge retrieval (PostgreSQL + pgvector)
- Embedded demo MCP server (`/demo/mcp`) with static secret auth
- Parent/child orchestration (single child delegation per turn)
- Langfuse traces and scoring (manual feedback + async LLM judge)
- OpenSpec tracking and HTML reporting

## Monorepo Structure

- `apps/api` - Express + TypeScript API
- `apps/web` - React + Vite frontend
- `infra/postgres` - local pgvector setup
- `openspec` - specs, changes, archive, report output
- `scripts` - smoke tests, cleanup, OpenSpec report generator

## Prerequisites

- Node.js 20+
- npm 10+
- Docker + Docker Compose

## Quick Start

1) Install dependencies

```bash
npm ci
```

2) Configure environment

- Copy your local settings into `.env` (not committed)
- Required for full features:
  - `DATABASE_URL`
  - `OPENAI_API_KEY`
  - `LANGFUSE_PUBLIC_KEY`
  - `LANGFUSE_SECRET_KEY`

3) Start stack

```bash
docker compose -f docker-compose.deploy.yml up -d --build
```

4) Open app

- Web: `http://localhost`
- API: `http://localhost:3001`

## Useful Commands

```bash
# Build
npm run -w apps/api build
npm run -w apps/web build

# OpenSpec review report
npm run openspec:review
npm run openspec:review:open

# Reset workspace for fresh testing
npm run cleanup:fresh
npm run cleanup:fresh:hard

# End-to-end smoke script
npm run smoke:e2e
```

## Core Features

### Agent Creation
- Create agents from UI
- Generate prompt draft via Agent Creator Skill
- Optional knowledge file upload
- Optional MCP config per agent (`mcpUrl`, `mcpSecret`)
- Optional child-agent selection for orchestration

### Chat
- Retrieval-aware responses
- MCP weather tool invocation for enabled agents
- Parent-child delegation (single child max per turn)
- Parent synthesizes final response

### Observability
- Langfuse trace capture for chat and skill generation
- User feedback scores (`user_feedback`)
- Async LLM judge scores (`judge_quality`)

## Security Notes

- `.env` and secret-like files are git-ignored
- Do not commit keys/tokens/secrets
- Demo MCP uses static bearer secret; use stronger auth in production

## OpenSpec

- `openspec/spec.md` - current implementation status by phase
- `openspec/changes.md` - active/upcoming work
- `openspec/archive.md` - completed changes
- `openspec/report.html` - generated dashboard
