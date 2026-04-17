# Agent Hub MVP — OpenSpec

## 1. Proposal

Build a lightweight Agent Hub platform where users can:
- browse agents
- run agents
- create their own agents
- upload files for context
- automatically improve agent creation using an Agent Creator Skill

Key differentiator:
Agent creation is guided by a skill that transforms user intent into a high-quality agent definition.

---

## 2. Design

### Architecture

Frontend:
- React + Vite + TypeScript

Backend:
- Node.js + TypeScript
- Express API

AI Layer:
- LangChain JS
- Langfuse for tracing

Vector Store:
- PostgreSQL + pgvector

Storage:
- PostgreSQL for agents/chunks
- Local file storage for uploads

---

### Core Modules

#### Agent Service
- Create agent
- List agents
- Get agent by ID

#### Chat Service
- Execute agent prompt
- Inject system prompt
- Inject retrieved context

#### File Service
- Upload files
- Extract text
- Chunk text

#### Vector Service
- Store embeddings in Chroma
- Retrieve top-k chunks

#### Agent Creator Skill
Input:
- name
- description
- goal
- output mode

Output:
- system prompt
- constraints
- example prompts
- evaluation cases

---

### Data Model

Agent:
- id
- name
- description
- goal
- systemPrompt
- outputMode
- hasKnowledge
- knowledgeOnly
- internetEnabled
- mcpEnabled
- mcpUrl
- childAgents
- createdAt

Chunks:
- id
- agentId
- text
- embedding

---

## 3. Tasks

### Phase 1 — Core Setup
- [x] Setup monorepo structure
- [x] Setup React app (Vite + TS)
- [x] Setup Node API (Express + TS)

### Phase 2 — Agent Basics
- [x] Create agent model
- [x] Implement list agents endpoint
- [x] Implement create agent endpoint
- [x] Hardcode 2 demo agents

### Phase 3 — Chat
- [x] Implement chat endpoint
- [x] Integrate LangChain
- [x] Apply system prompt

### Phase 4 — Agent Creator Skill
- [x] Implement agentCreatorSkill.ts
- [x] Generate improved system prompt
- [x] Generate example prompts

### Phase 5 — File + Chroma
- [x] File upload endpoint
- [x] Extract text
- [x] Chunk text
- [x] Store embeddings in Chroma
- [x] Retrieve top-k chunks

### Phase 6 — Retrieval Chat
- [x] Inject retrieved chunks into prompt
- [x] Toggle knowledge usage per agent

### Phase 7 — Langfuse
- [x] Trace chat calls
- [x] Trace agent creation skill

### Phase 8 — Demo UI
- [x] Build web dashboard for agent list and selection
- [x] Add agent creation flow with Agent Creator Skill prompt generation
- [x] Add file upload and retrieval chat interaction
- [x] Add Langfuse trace visibility link in UI

### Phase 9 — Production Readiness
- [x] Persist agents and chunks to durable storage
- [x] Replace mock vector retrieval with pgvector retrieval in PostgreSQL
- [x] Add auth and basic rate limiting for API endpoints
- [x] Add error handling and request validation hardening
- [x] Add deployment configuration for API and web
- [x] Add smoke and integration tests for end-to-end flow

### Phase 10 — MCP Tooling
- [x] Roll back previous MCP OAuth/global-config implementation to clean baseline
- [x] Add embedded demo MCP endpoint in API process (`POST /demo/mcp`)
- [x] Add static secret auth for demo MCP (`Authorization: Bearer <secret>`)
- [x] Add per-agent single MCP config (`mcpEnabled`, `mcpUrl`, `mcpSecret`)
- [x] Invoke MCP tool during chat and merge tool output into context
- [x] Add MCP connection test endpoint (`POST /mcp/test`)
- [x] Add UI controls for MCP URL/secret plus "Test MCP Connection" button

### Phase 11 — Multi-Agent Orchestration
- [x] Add `agent_children` relation table for parent-child links
- [x] Extend agent creation API to accept `childAgentIds`
- [x] Validate child IDs exist and reject invalid values
- [x] Return child agent summaries in agent list/detail responses
- [x] Add parent routing step constrained to configured child IDs
- [x] Enforce single-child delegation per chat turn
- [x] Implement parent-synthesized final answer using child output as context
- [x] Add fail-soft fallback when child invocation fails
- [x] Add delegation trace metadata for observability
- [x] Add create-agent UI child multi-select from existing agents
- [x] Show child count and child names in agent cards
- [x] Add runtime flag `ENABLE_CHILD_ORCHESTRATION` for quick rollback

### Phase 12 — Agent Discovery UX
- [x] Add live search input on main page
- [x] Search across name, description, goal, system prompt, and child agent names
- [x] Add clear control and result count for filtered agents
- [x] Add search-specific empty state when no matches are found
- [x] Add `/` keyboard shortcut to focus search input
- [x] Preserve responsive layout behavior across desktop and mobile

---

## 4. Implementation Notes

- Keep everything minimal
- Optimize for demo, not production
- Build happy path first
- Use mocks if blocked

---

## 5. Demo Flow

1. Show agent list
2. Use an agent
3. Create a new agent with attached files and optional single MCP URL + secret
4. Show improved agent prompt
5. Ask question using retrieved knowledge and demo MCP weather tool results
6. Show tracing in Langfuse
7. Create parent agent with selected child agents
8. Ask parent a routing-style question and verify single-child delegation with synthesized final answer

---

## 6. OpenSpec Workflow

Use this lightweight change lifecycle for implementation work:

1. Add change item to `openspec/changes.md` with status `proposed`
2. Move status to `in_progress` when work starts
3. Mark `completed` when validated
4. Move completed entry to `openspec/archive.md`

Status values:
- proposed
- in_progress
- completed
- archived
