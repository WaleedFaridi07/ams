# AMS Usage Runbook

This runbook gives practical, copy-paste usage flows for local demo and testing.

## 1) Start the stack

From repository root:

```bash
npm ci
cp .env.example .env
docker compose -f docker-compose.deploy.yml up -d --build
```

Open:

- Web: `http://localhost`
- API: `http://localhost:3001`

## 2) Create and use a basic agent

1. Click `Add Agent`.
2. Fill `name`, `description`, `goal`, `systemPrompt`.
3. (Optional) attach files in create modal for knowledge.
4. Click `Create Agent`.
5. Click `Chat` on the new card and ask a question.

Tip: set `knowledgeOnly=true` behavior by toggling files-only style in the UI so responses are grounded to uploaded docs.

## 3) Use MCP weather tool

In create modal:

- Enable MCP
- MCP URL: `http://localhost:3001/demo/mcp`
- MCP Secret: `demo-secret` (or value from `DEMO_MCP_SHARED_SECRET`)
- Click `Test MCP Connection`

Then chat with prompts like:

- `weather in stockholm`
- `weather in berlin`

## 4) Parent-child orchestration

1. Create/choose child specialist agents first.
2. Create parent agent and select child agents in `Child agents (optional)`.
3. Chat with parent.
4. Check assistant meta in chat bubble for delegation info.

Notes:

- V1 allows max one child invocation per turn.
- Parent returns synthesized final response.
- Routing mode controlled by `CHILD_ROUTING_MODE`:
  - `llm_strict`
  - `hybrid`

## 5) Feedback and quality comparison

1. In chat, rate responses with `👍` / `👎`.
2. Open `Agent Feedback` modal from main page.
3. Review:
   - Positive rate / votes
   - Judge average / judge count

Langfuse score names:

- `user_feedback`
- `judge_quality`

## 6) RAG operations

### Reindex stored vectors

```bash
npm run rag:reindex
```

### Tune retrieval behavior (in `.env`)

- `RAG_TOP_K`
- `RAG_MIN_SIMILARITY`
- `RAG_CHUNK_SIZE`
- `RAG_CHUNK_OVERLAP`
- `EMBEDDING_PROVIDER`
- `EMBEDDING_MODEL`
- `EMBEDDING_DIM`

## 7) OpenSpec workflow

Generate report:

```bash
npm run openspec:review
```

Generate + open report:

```bash
npm run openspec:review:open
```

Slash command aliases (OpenCode):

- `/openspec-review`
- `/openspec-reiew`

See also: `docs/SKILLS.md` for a dedicated skill reference.

## 7.1) Agent Creator Skill

In the create-agent modal, use the draft-generation action to invoke the backend skill and prefill stronger prompt guidance.

Backend route used:

- `POST /skills/agent-creator`

## 8) Reset for fresh testing

Soft reset (keeps seed agents):

```bash
npm run cleanup:fresh
```

Hard reset (wipes Docker volumes):

```bash
npm run cleanup:fresh:hard
```

## 9) Troubleshooting

### Search bar not visible

1. Rebuild web container
2. Hard refresh browser (`Cmd+Shift+R`)

### MCP test fails

- Confirm MCP URL is reachable
- Confirm bearer secret matches `DEMO_MCP_SHARED_SECRET`
- Verify API logs: `docker compose -f docker-compose.deploy.yml logs api`

### Parent not delegating as expected

- Confirm child agents are selected on parent
- Check `CHILD_ROUTING_MODE`
- Review `delegation.reason` in `/chat` response

### Retrieval not finding context

- Confirm agent has chunks (`GET /agents/:id/chunks`)
- Reindex vectors: `npm run rag:reindex`
- Loosen threshold (`RAG_MIN_SIMILARITY`)
