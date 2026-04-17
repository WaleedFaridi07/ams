# AMS API

Express + TypeScript backend for Agent Management Studio.

## Responsibilities

- Agent CRUD and child-agent relationship management
- File upload + text extraction + chunk embedding persistence
- Vector retrieval using PostgreSQL + pgvector
- Chat orchestration:
  - retrieval
  - optional MCP invocation
  - optional parent/child delegation (single child max)
- Langfuse trace + score integration
- Feedback and leaderboard metrics endpoints

## Key Endpoints

- `GET /health`
- `GET /agents`, `GET /agents/:id`, `POST /agents`
- `PATCH /agents/:id/knowledge`
- `POST /files/upload`
- `GET /agents/:id/chunks`
- `POST /chat`
- `POST /chat/feedback`
- `GET /metrics/agents/feedback`
- `POST /skills/agent-creator`
- `GET /demo/weather`, `POST /demo/mcp`, `POST /mcp/test`

## Config Flags (most relevant)

- Embeddings/RAG:
  - `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIM`
  - `RAG_TOP_K`, `RAG_MIN_SIMILARITY`
  - `RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP`
- Orchestration:
  - `ENABLE_CHILD_ORCHESTRATION`, `CHILD_ROUTING_MODE`
- Scoring:
  - `ENABLE_LLM_JUDGE`, `LLM_JUDGE_MODEL`
- MCP demo:
  - `DEMO_MCP_SHARED_SECRET`

## Reindex Existing Vectors

From repo root:

```bash
npm run rag:reindex
```
