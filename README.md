# AMS - Agent Management Studio

AMS is a full-stack monorepo demo platform for creating, running, and evaluating AI agents.

## What You Get

- Agent creation from UI with prompt-assist drafting
- File-based RAG on PostgreSQL + pgvector
- Demo MCP integration (weather tool) with static bearer secret
- Parent/child orchestration (parent can delegate to one child per turn)
- Langfuse traces + scoring:
  - manual thumbs (`user_feedback`)
  - async LLM judge (`judge_quality`)
- OpenSpec workflow + local HTML status report

## Repository Layout

- `apps/api` - Express + TypeScript backend
- `apps/web` - React + Vite frontend
- `infra/postgres` - pgvector Postgres compose stack
- `infra/langfuse` - local Langfuse compose stack (optional)
- `openspec` - spec/change/archive/report docs
- `scripts` - cleanup, smoke, OpenSpec report, RAG reindex

## Prerequisites

- Node.js 20+
- npm 10+
- Docker + Docker Compose

## Quick Start

1. Install dependencies

```bash
npm ci
```

2. Create local env file

```bash
cp .env.example .env
```

3. Fill required values in `.env`

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`

4. Start stack

```bash
docker compose -f docker-compose.deploy.yml up -d --build
```

5. Open services

- Web: `http://localhost`
- API: `http://localhost:3001`

## Core Usage Flows

### Create an Agent

1. Click `Add Agent`
2. Fill basic fields (`name`, `description`, `goal`, `systemPrompt`)
3. Optionally attach files for knowledge
4. Optionally enable MCP and set:
   - `MCP URL` (default: `http://localhost:3001/demo/mcp`)
   - `MCP Secret` (default demo: `demo-secret`)
5. Optionally select child agents (parent orchestration)

### Chat with an Agent

- Click `Chat` on any agent card
- For parent agents, routing chooses one child or none
- Parent always returns synthesized final output
- For MCP-enabled agents, tool output is added into context

### Score Responses

- In chat modal, rate assistant turns with `👍` or `👎`
- Open `Agent Feedback` modal for per-agent leaderboard
- Compare:
  - positive rate / vote count
  - LLM judge average / count

## RAG (Vector Search) Details

- Embeddings are generated in `apps/api/src/embedding.ts`
- Chunk vectors and query vectors are persisted/searched in pgvector
- Retrieval uses nearest-neighbor distance (`embedding <=> query`)
- Optional similarity filter via `RAG_MIN_SIMILARITY`

### Reindex Existing Chunks

Use when changing embedding model/provider or after introducing real embeddings:

```bash
npm run rag:reindex
```

## Important Commands

```bash
# Build
npm run -w apps/api build
npm run -w apps/web build

# Reindex vectors
npm run rag:reindex

# OpenSpec report
npm run openspec:review
npm run openspec:review:open

# Reset workspace (soft/hard)
npm run cleanup:fresh
npm run cleanup:fresh:hard

# E2E smoke flow
npm run smoke:e2e
```

## Environment Flags (Most Used)

- `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIM`
- `RAG_TOP_K`, `RAG_MIN_SIMILARITY`
- `RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP`
- `ENABLE_CHILD_ORCHESTRATION`, `CHILD_ROUTING_MODE`
- `ENABLE_LLM_JUDGE`, `LLM_JUDGE_MODEL`
- `DEMO_MCP_SHARED_SECRET`

See `.env.example` for full list.

## Security Notes

- `.env` and secret-like files are ignored in git
- Never commit tokens, API keys, or private keys
- Current MCP auth is demo-grade static secret; use OAuth/service auth for production
- Rotate any accidentally exposed secrets immediately

## OpenSpec Docs

- `openspec/spec.md` - phase checklist and current implementation state
- `openspec/changes.md` - active/upcoming changes
- `openspec/archive.md` - completed change history
- `openspec/report.html` - generated visual status report

## Additional Docs

- `docs/USAGE.md` - step-by-step usage, demo flows, operations, and troubleshooting
- `docs/SKILLS.md` - skill catalog (API skill + OpenCode slash command skill)
- `docs/ARCHITECTURE-DIAGRAM.md` - visual flow diagrams (topology + runtime sequence)
- `ARCHITECTURE.md` - system design and runtime behavior
- `apps/api/README.md` - backend endpoint and config notes
- `apps/web/README.md` - frontend behavior and interaction notes
