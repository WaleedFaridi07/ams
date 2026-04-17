# Skills Guide

This project currently uses two skill-style flows:

1. **Agent Creator Skill** (backend/API feature)
2. **OpenSpec Review Slash Skill** (OpenCode command prompt files)

---

## 1) Agent Creator Skill

Purpose:

- Convert rough agent intent into a stronger agent definition draft.
- Provide system prompt guidance, constraints, examples, and evaluation cases.

Where it lives:

- Source: `packages/agent-skill/src/agentCreatorSkill.ts`
- API route: `POST /skills/agent-creator`

Typical usage flow:

1. User opens create-agent modal.
2. User enters basic intent fields.
3. UI calls `POST /skills/agent-creator`.
4. API returns structured draft (`systemPrompt`, constraints, examples, tests).
5. User reviews/edits and creates final agent.

Notes:

- Skill output is assistive, not auto-finalized.
- Calls are traced in Langfuse for observability.

---

## 2) OpenSpec Review Slash Skill

Purpose:

- Summarize OpenSpec status and generate local HTML report.

Where it lives:

- Main prompt file: `.opencode/openspec-review.md`
- Command shim: `.opencode/commands/openspec-review.md`
- Alias typo support:
  - `.opencode/openspec-reiew.md`
  - `.opencode/commands/openspec-reiew.md`

Commands:

- `/openspec-review`
- `/openspec-reiew` (alias)

What it does:

1. Reads OpenSpec files:
   - `openspec/spec.md`
   - `openspec/changes.md`
   - `openspec/archive.md`
2. Runs:

```bash
npm run openspec:review:open
```

3. Reports counts and output path:
   - `openspec/report.html`

---

## Related scripts

- `npm run openspec:review` - generate report only
- `npm run openspec:review:open` - generate and open in browser
