# AMS Architecture Diagram

This diagram shows the high-level runtime flow and key integrations.

## 1) System Topology

```mermaid
flowchart LR
    U[User Browser\nReact + Vite UI] -->|HTTP| API[AMS API\nExpress + TypeScript]

    API --> DB[(PostgreSQL + pgvector)]
    API --> MCP[Demo MCP Endpoint\nPOST /demo/mcp]
    API --> LLM[OpenAI\nChat + Embeddings]
    API --> LF[Langfuse\nTraces + Scores]

    subgraph Repo[AMS Monorepo]
      WEB[apps/web]
      BACK[apps/api]
      SKILL[packages/agent-skill]
      OPS[openspec + scripts]
    end

    WEB -.build/deploy.-> U
    BACK -.runtime.-> API
    SKILL -.used by.-> API
    OPS -.status/reporting.-> API
```

## 2) Chat Execution Flow (with RAG + MCP + Parent/Child)

```mermaid
sequenceDiagram
    autonumber
    participant UI as Web UI
    participant API as AMS API
    participant DB as Postgres/pgvector
    participant MCP as Demo MCP
    participant LLM as OpenAI
    participant LF as Langfuse

    UI->>API: POST /chat (agentId, message, useKnowledge)
    API->>API: Load agent config + flags

    alt Knowledge enabled
      API->>LLM: Embed query text
      API->>DB: Vector search top-k chunks
      DB-->>API: Retrieved chunks
    end

    alt MCP enabled for agent
      API->>MCP: tools/list + tools/call
      MCP-->>API: Tool result (e.g. weather)
    end

    alt Parent has child agents
      API->>LLM: Route to one child or none
      alt Child selected
        API->>API: Invoke child flow (single child max)
        API->>LLM: Parent synthesis using child output
      else No child selected
        API->>LLM: Parent direct response
      end
    else No child agents
      API->>LLM: Standard response generation
    end

    API->>LF: Record trace metadata
    API-->>UI: Chat response + traceId + delegation + retrieval meta

    opt Async scoring
      UI->>API: POST /chat/feedback (thumbs)
      API->>LF: user_feedback score
      API->>LLM: Async judge rubric
      API->>LF: judge_quality score
    end
```

## 3) Agent Creation Flow

```mermaid
flowchart TD
    A[Create Agent Modal] --> B[Optional Skill Draft\nPOST /skills/agent-creator]
    B --> C[Submit POST /agents]
    C --> D[Persist agent + child links]
    C --> E[Optional file parsing/chunking]
    E --> F[Embed chunks]
    F --> G[Insert vectors to pgvector]
    D --> H[Return hydrated agent]
    G --> H
```

## Notes

- Parent-child orchestration is feature-flagged via `ENABLE_CHILD_ORCHESTRATION`.
- Routing mode can be `llm_strict` or `hybrid` via `CHILD_ROUTING_MODE`.
- RAG behavior is tunable with `RAG_TOP_K`, `RAG_MIN_SIMILARITY`, `RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP`.
