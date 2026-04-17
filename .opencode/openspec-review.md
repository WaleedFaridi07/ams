# /openspec-review

Review OpenSpec status and generate a local HTML report.

## What this command does

1. Reads these files:
   - `openspec/spec.md`
   - `openspec/changes.md`
   - `openspec/archive.md`
2. Runs `npm run openspec:review:open` so the generated HTML opens in the default browser automatically.
3. Reports:
   - active changes
   - proposed and in-progress changes
   - completed and pending checklist tasks
   - archived change count
4. Returns output path: `openspec/report.html`.

## Response format

- One short status paragraph.
- Bullet list of key counts.
- Final line with: `Report: openspec/report.html`.
