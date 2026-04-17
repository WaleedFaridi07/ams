# OpenSpec Archive

Completed changes are moved here for traceability.

- id: CHG-001
  title: Monorepo root and workspace setup
  status: archived
  phase: Phase 1 - Core Setup
  completedAt: 2026-04-16
  notes:
    - Created root workspace `package.json`
    - Installed root dependencies via npm workspaces
    - Created base directories for packages/data/openspec

- id: CHG-002
  title: Hardcoded agent basics in API
  status: archived
  phase: Phase 2 - Agent Basics
  completedAt: 2026-04-16
  notes:
    - Added in-memory agent model and 2 demo agents
    - Added `GET /agents`, `GET /agents/:id`, `POST /agents`
    - Converted `apps/api` to proper workspace package layout

- id: CHG-003
  title: Implement chat endpoint with system prompt
  status: archived
  phase: Phase 3 - Chat
  completedAt: 2026-04-16
  notes:
    - Added `POST /chat` endpoint
    - Validates `agentId` and `message`
    - Routes response generation through selected agent `systemPrompt`

- id: CHG-004
  title: Agent Creator Skill scaffold
  status: archived
  phase: Phase 4 - Agent Creator Skill
  completedAt: 2026-04-16
  notes:
    - Added `packages/agent-skill/src/agentCreatorSkill.ts`
    - Added typed input and output contract for agent definition generation
    - Generates system prompt, constraints, example prompts, and evaluation cases

- id: CHG-005
  title: File upload and chunk pipeline scaffold
  status: archived
  phase: Phase 5 - File + Chroma
  completedAt: 2026-04-16
  notes:
    - Added `POST /files/upload` endpoint for local file storage
    - Added text extraction placeholder function
    - Added chunking placeholder function and in-memory chunk records

- id: CHG-006
  title: Vector scaffold and retrieval endpoint
  status: archived
  phase: Phase 5 - File + Chroma
  completedAt: 2026-04-16
  notes:
    - Added `packages/vector` mock Chroma scaffold with upsert and cosine-similarity search
    - Added mock embeddings generation for uploaded chunks
    - Added `GET /agents/:id/chunks` top-k retrieval endpoint

- id: CHG-007
  title: Retrieval-aware chat and knowledge toggle
  status: archived
  phase: Phase 6 - Retrieval Chat
  completedAt: 2026-04-16
  notes:
    - Updated `POST /chat` to optionally inject retrieved chunks into response context
    - Added `useKnowledge` and `topK` controls in chat payload
    - Added `PATCH /agents/:id/knowledge` to toggle per-agent knowledge usage

- id: CHG-008
  title: Integrate LangChain in chat flow
  status: archived
  phase: Phase 3 - Chat
  completedAt: 2026-04-16
  notes:
    - Added LangChain + OpenAI adapter dependencies to `apps/api`
    - Routed `POST /chat` generation through LangChain when `OPENAI_API_KEY` is configured
    - Kept robust mock fallback when key is missing or model call fails

- id: CHG-009
  title: Add Langfuse tracing for chat and skill
  status: archived
  phase: Phase 7 - Langfuse
  completedAt: 2026-04-16
  notes:
    - Added Langfuse SDK integration and trace recording helper in API
    - Traced `POST /chat` requests with provider and retrieval metadata
    - Added `POST /skills/agent-creator` endpoint and traced skill generation calls
    - Started local Langfuse instance with Docker Compose at `infra/langfuse/docker-compose.yml`

- id: CHG-010
  title: Build demo UI for full agent flow
  status: archived
  phase: Phase 8 - Demo UI
  completedAt: 2026-04-16
  notes:
    - Replaced Vite starter page with Agent Hub dashboard UI
    - Added agent listing/selection, creation, knowledge upload, and retrieval chat flows
    - Added Agent Creator Skill generation action and Langfuse trace link in UI

- id: CHG-011
  title: Start production-readiness track
  status: archived
  phase: Phase 9 - Production Readiness
  completedAt: 2026-04-16
  notes:
    - Added schema validation with Zod for chat, agent creation, upload, skill, and query payloads
    - Added centralized 404 and error middleware with structured JSON error responses
    - Added shared helpers for async route handling and agent lookup

- id: CHG-012
  title: Add auth and basic rate limiting
  status: archived
  phase: Phase 9 - Production Readiness
  completedAt: 2026-04-16
  notes:
    - Added API key middleware using `x-api-key` when `API_ACCESS_KEY` is configured
    - Added per-IP rate limiting middleware with configurable window/max env vars
    - Added `.env` settings for `API_ACCESS_KEY`, `RATE_LIMIT_WINDOW_MS`, and `RATE_LIMIT_MAX`

- id: CHG-013
  title: Add PostgreSQL + pgvector persistence
  status: archived
  phase: Phase 9 - Production Readiness
  completedAt: 2026-04-16
  notes:
    - Added PostgreSQL pgvector Docker stack at `infra/postgres/docker-compose.yml`
    - Replaced in-memory agent/chunk repositories with Postgres-backed storage in API
    - Added database bootstrap for schema, vector extension, and demo seed data

- id: CHG-014
  title: Add deployment configuration stack
  status: archived
  phase: Phase 9 - Production Readiness
  completedAt: 2026-04-16
  notes:
    - Added Dockerfiles for API and web plus nginx reverse proxy config
    - Added deployment compose stack at `docker-compose.deploy.yml`
    - Added `.dockerignore` and API start script for runtime container boot

- id: CHG-015
  title: Add end-to-end smoke test runner
  status: archived
  phase: Phase 9 - Production Readiness
  completedAt: 2026-04-16
  notes:
    - Added root smoke script at `scripts/smoke-e2e.sh`
    - Added root script alias `npm run smoke:e2e`
    - Validated full API flow including create/upload/chat against running Postgres

- id: CHG-016
  title: Add MCP OAuth integration for agents
  status: archived
  phase: Phase 10 - MCP Tooling
  completedAt: 2026-04-16
  notes:
    - Added MCP server registry endpoints with OAuth client credentials config
    - Added env-backed `clientSecretRef` resolution at invocation time
    - Added MCP server attachment during agent creation and MCP invocation in chat flow

- id: CHG-017
  title: Reset MCP implementation to clean baseline
  status: archived
  phase: Phase 10 - MCP Tooling
  completedAt: 2026-04-17
  notes:
    - Removed previous MCP OAuth/global OpenCode config integration from API routes
    - Removed MCP selection flow from web UI to unblock a clean restart
    - Removed OpenCode host mounts from deployment compose stack

- id: CHG-018
  title: Add embedded demo MCP weather integration
  status: archived
  phase: Phase 10 - MCP Tooling
  completedAt: 2026-04-17
  notes:
    - Added embedded demo endpoints `GET /demo/weather` and `POST /demo/mcp` in API process
    - Added static bearer auth for demo MCP via `DEMO_MCP_SHARED_SECRET`
    - Added per-agent MCP fields (`mcp_enabled`, `mcp_url`, `mcp_secret`) and masked secret in API responses
    - Added chat-time MCP invocation (`get_weather`) with fail-soft behavior and invocation metadata
    - Added `POST /mcp/test` plus web UI button "Test MCP Connection"

- id: CHG-019
  title: Add parent-child agent orchestration (single child per turn)
  status: archived
  phase: Phase 11 - Multi-Agent Orchestration
  completedAt: 2026-04-17
  notes:
    - Added `agent_children` relation table with self-link protection and cascade cleanup
    - Extended agent creation to accept `childAgentIds` and validate existing child agents
    - Added child agent summaries to list/detail agent responses and UI cards
    - Implemented parent routing with single-child selection and heuristic fallback
    - Implemented child invocation + parent-synthesized final response in chat flow
    - Added delegation metadata in chat response/traces for observability
    - Added feature flag `ENABLE_CHILD_ORCHESTRATION` for quick rollback behavior

- id: CHG-020
  title: Add live agent search by name and prompt content
  status: archived
  phase: Phase 12 - Agent Discovery UX
  completedAt: 2026-04-17
  notes:
    - Added main-page live search input with case-insensitive filtering
    - Included search fields: name, description, goal, system prompt, and child agent names
    - Added clear control, filtered result count, and no-match empty-state message
    - Added `/` keyboard shortcut to focus search input when not typing in a form field
    - Kept responsive hero layout intact while introducing search controls

- id: CHG-021
  title: Upgrade RAG quality with real embeddings and gated rollout
  status: archived
  phase: Phase 13 - RAG Quality Upgrade
  completedAt: 2026-04-17
  notes:
    - Added shared embedding service (`apps/api/src/embedding.ts`) for ingest/query embeddings
    - Switched file indexing and query retrieval to real embeddings with deterministic fallback
    - Added reindex utility `npm run rag:reindex` for existing chunk backfill
    - Added configurable chunking (`RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP`)
    - Added retrieval tuning (`RAG_TOP_K`, optional `RAG_MIN_SIMILARITY`)
    - Tightened `knowledgeOnly` grounding and lightweight citation guidance in prompts
    - Updated docs/env templates for RAG rollout, tuning, and reindex operations
