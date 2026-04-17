# AMS Architecture

## Overview

AMS is a full-stack monorepo with an API-first backend and React frontend.

High-level flow:
1. User creates/configures agents in web UI.
2. API persists agent metadata and chunk embeddings in PostgreSQL + pgvector.
3. Chat requests run retrieval, optional MCP/tool calls, optional child-agent orchestration.
4. Final responses are generated via LangChain/OpenAI (or mocked fallback).
5. Traces/scores are recorded in Langfuse.

## Components

### Frontend (`apps/web`)
- React + Vite + TypeScript
- Agent grid, create modal, feedback modal, chat modal
- Live search across name/goal/system prompt/child agents
- Sends API calls for:
  - agent CRUD
  - chat
  - feedback scoring
  - metrics
  - MCP connection test

### Backend (`apps/api`)
- Express + TypeScript
- Zod request validation
- Rate limiting + optional API key auth
- Endpoints:
  - `GET/POST /agents`
  - `POST /chat`
  - `POST /chat/feedback`
  - `GET /metrics/agents/feedback`
  - MCP demo + test endpoints

### Data Layer
- PostgreSQL tables:
  - `agents`
  - `chunks`
  - `agent_children`
  - `users` (seed/demo)
- pgvector used for nearest-neighbor retrieval (`embedding <=> query`)

## Runtime Pipelines

### Agent Creation
1. Validate payload.
2. Persist agent.
3. Persist child-agent links (if any).
4. Parse and chunk uploaded files.
5. Insert chunk vectors.

### Chat Execution
1. Load target agent.
2. Retrieve knowledge chunks (if enabled/forced).
3. Invoke MCP (if configured).
4. If parent has child agents:
   - route to at most one child
   - invoke child
   - parent synthesizes final response
5. Record Langfuse trace.
6. Enqueue async LLM judge scoring job.

### Scoring
- Manual: UI thumbs -> `POST /chat/feedback` -> `user_feedback` score in Langfuse
- Async judge: background queue computes `judge_quality` score with rubric
- Metrics endpoint aggregates by agent for dashboard comparison

## MCP Integration (Demo)

- Embedded MCP endpoint at `POST /demo/mcp`
- Static bearer auth using `DEMO_MCP_SHARED_SECRET`
- Tooling includes demo weather tool (`get_weather`)

## Orchestration (v1)

- Parent can have many configured child agents.
- Per user turn, parent routes to zero/one child only.
- Child output is context input; parent returns synthesized final response.
- Feature flag for fast rollback:
  - `ENABLE_CHILD_ORCHESTRATION=true|false`

## Deployment

- Docker Compose stack (`docker-compose.deploy.yml`):
  - `web` (nginx static)
  - `api` (Node runtime)
  - `postgres` (pgvector)

## Non-Goals (current demo)

- Multi-tenant user auth model
- Durable background queue for judge jobs (currently in-memory)
- Production-grade secret management
- Recursive or multi-child fanout orchestration
