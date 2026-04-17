import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const specPath = path.join(rootDir, "openspec", "spec.md");
const changesPath = path.join(rootDir, "openspec", "changes.md");
const archivePath = path.join(rootDir, "openspec", "archive.md");
const reportPath = path.join(rootDir, "openspec", "report.html");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseSpec(specText) {
  const checkedTasks = (specText.match(/^- \[x\]/gm) ?? []).length;
  const pendingTasks = (specText.match(/^- \[ \]/gm) ?? []).length;

  const phaseRegex = /^###\s+(Phase[^\n]+)\n([\s\S]*?)(?=^###\s+Phase|^---|^##\s+|\Z)/gm;
  const phases = [];
  let match = phaseRegex.exec(specText);

  while (match) {
    const phaseName = match[1].trim();
    const body = match[2];
    const done = (body.match(/^- \[x\]/gm) ?? []).length;
    const todo = (body.match(/^- \[ \]/gm) ?? []).length;
    phases.push({
      name: phaseName,
      done,
      todo,
      total: done + todo,
    });

    match = phaseRegex.exec(specText);
  }

  return {
    checkedTasks,
    pendingTasks,
    phases,
  };
}

function parseChanges(changesText) {
  const statuses = {
    proposed: 0,
    in_progress: 0,
    completed: 0,
    archived: 0,
  };

  const activeSection =
    changesText.match(/##\s+Active\n([\s\S]*?)(?=\n##\s+Template|\Z)/m)?.[1] ?? "";
  const statusMatches =
    activeSection.match(/^\s*status:\s*(proposed|in_progress|completed|archived)\s*$/gm) ?? [];
  for (const line of statusMatches) {
    const status = line.split(":")[1].trim();
    if (status in statuses) {
      statuses[status] += 1;
    }
  }

  const activeChanges = statuses.proposed + statuses.in_progress + statuses.completed;

  return {
    ...statuses,
    activeChanges,
  };
}

function parseArchive(archiveText) {
  const blocks = archiveText
    .split(/\n(?=- id:\s)/g)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("- id:"));

  const entries = blocks.map((block) => {
    const id = block.match(/^- id:\s*(.+)$/m)?.[1]?.trim() ?? "";
    const title = block.match(/^\s*title:\s*(.+)$/m)?.[1]?.trim() ?? "";
    const phase = block.match(/^\s*phase:\s*(.+)$/m)?.[1]?.trim() ?? "";
    const completedAt = block.match(/^\s*completedAt:\s*(.+)$/m)?.[1]?.trim() ?? "";
    const status = block.match(/^\s*status:\s*(.+)$/m)?.[1]?.trim() ?? "";
    const notes = Array.from(block.matchAll(/^\s*-\s+(.+)$/gm)).map((item) => item[1].trim());

    return {
      id,
      title,
      phase,
      completedAt,
      status,
      notes,
    };
  });

  return {
    count: entries.length,
    entries,
  };
}

function healthBadge(spec, changes) {
  if (spec.pendingTasks === 0 && changes.activeChanges === 0) {
    return {
      label: "All tasks complete, no active changes",
      tone: "good",
    };
  }

  if (changes.in_progress > 0 || spec.pendingTasks > 0) {
    return {
      label: "Work in progress",
      tone: "warn",
    };
  }

  return {
    label: "Needs attention",
    tone: "bad",
  };
}

function buildHtml({ spec, changes, archive, generatedAt }) {
  const health = healthBadge(spec, changes);

  const phaseChartRows = spec.phases
    .map((phase) => {
      const donePct = phase.total === 0 ? 0 : Math.round((phase.done / phase.total) * 100);
      const todoPct = Math.max(0, 100 - donePct);
      return `
        <div class="chart-row">
          <div class="chart-label">${escapeHtml(phase.name)}</div>
          <div class="chart-track" role="img" aria-label="${escapeHtml(phase.name)} ${donePct}% complete">
            <span class="bar-done" style="width:${donePct}%"></span>
            <span class="bar-todo" style="width:${todoPct}%"></span>
          </div>
          <div class="chart-value">${donePct}%</div>
        </div>`;
    })
    .join("\n");

  const phaseRows = spec.phases
    .map((phase) => {
      const pct = phase.total === 0 ? 0 : Math.round((phase.done / phase.total) * 100);
      return `
        <tr>
          <td>${escapeHtml(phase.name)}</td>
          <td>${phase.done}</td>
          <td>${phase.todo}</td>
          <td>${phase.total}</td>
          <td>${pct}%</td>
        </tr>`;
    })
    .join("\n");

  const archiveRows = archive.entries
    .map((entry) => {
      const notes = entry.notes.length
        ? `<ul>${entry.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
        : "-";

      return `
        <tr>
          <td>${escapeHtml(entry.id)}</td>
          <td>${escapeHtml(entry.title)}</td>
          <td>${escapeHtml(entry.phase)}</td>
          <td>${escapeHtml(entry.completedAt)}</td>
          <td>${escapeHtml(entry.status)}</td>
          <td>${notes}</td>
        </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenSpec Review Report</title>
  <style>
    :root {
      --bg: #f6f7f9;
      --card: #ffffff;
      --line: #d7dbe2;
      --ink: #1e2630;
      --muted: #5f6b7b;
      --good: #1f8a4c;
      --warn: #a06b00;
      --bad: #b33a3a;
      --accent: #0f5f9d;
    }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, Segoe UI, Helvetica, Arial, sans-serif;
      color: var(--ink);
      background: linear-gradient(160deg, #f2f6fb 0%, #f8f3ea 100%);
    }
    .wrap {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      gap: 18px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 8px 24px rgba(20, 33, 49, 0.06);
    }
    h1, h2 {
      margin: 0 0 8px;
    }
    .meta {
      color: var(--muted);
      font-size: 14px;
      margin-top: 6px;
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
    }
    .kpi {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      background: #fcfdff;
    }
    .kpi .label { color: var(--muted); font-size: 12px; }
    .kpi .value { font-size: 26px; font-weight: 700; margin-top: 4px; }
    .health {
      border-left: 6px solid var(--accent);
      padding: 10px 12px;
      border-radius: 8px;
      background: #f7fbff;
      font-weight: 600;
    }
    .health.good { border-left-color: var(--good); color: var(--good); }
    .health.warn { border-left-color: var(--warn); color: var(--warn); }
    .health.bad { border-left-color: var(--bad); color: var(--bad); }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th, td {
      border: 1px solid var(--line);
      padding: 8px;
      vertical-align: top;
    }
    th {
      background: #eef3f9;
      text-align: left;
    }
    ul {
      margin: 0;
      padding-left: 18px;
    }
    .chart-grid {
      display: grid;
      gap: 10px;
    }
    .chart-row {
      display: grid;
      grid-template-columns: 240px 1fr 58px;
      align-items: center;
      gap: 10px;
    }
    .chart-label {
      color: var(--ink);
      font-size: 14px;
    }
    .chart-track {
      height: 14px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #f5f8fc;
      overflow: hidden;
      display: flex;
    }
    .bar-done {
      background: linear-gradient(90deg, #1f8a4c, #42a36a);
      height: 100%;
      display: block;
    }
    .bar-todo {
      background: linear-gradient(90deg, #d8dee8, #cfd6e2);
      height: 100%;
      display: block;
    }
    .chart-value {
      font-weight: 700;
      color: var(--ink);
      text-align: right;
      font-size: 13px;
    }
    @media (max-width: 1000px) {
      .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .chart-row { grid-template-columns: 1fr; }
      .chart-value { text-align: left; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <h1>OpenSpec Review Report</h1>
      <p class="meta">Generated: ${escapeHtml(generatedAt)}</p>
      <p class="meta">Sources: openspec/spec.md, openspec/changes.md, openspec/archive.md</p>
    </section>

    <section class="card">
      <div class="kpis">
        <article class="kpi"><div class="label">Active Changes</div><div class="value">${changes.activeChanges}</div></article>
        <article class="kpi"><div class="label">In Progress</div><div class="value">${changes.in_progress}</div></article>
        <article class="kpi"><div class="label">Proposed</div><div class="value">${changes.proposed}</div></article>
        <article class="kpi"><div class="label">Completed Tasks</div><div class="value">${spec.checkedTasks}</div></article>
        <article class="kpi"><div class="label">Pending Tasks</div><div class="value">${spec.pendingTasks}</div></article>
        <article class="kpi"><div class="label">Archived Changes</div><div class="value">${archive.count}</div></article>
      </div>
      <p class="health ${health.tone}">${escapeHtml(health.label)}</p>
    </section>

    <section class="card">
      <h2>Phase Completion</h2>
      <div class="chart-grid">
        ${phaseChartRows}
      </div>
    </section>

    <section class="card">
      <h2>Phase Completion Table</h2>
      <table>
        <thead>
          <tr>
            <th>Phase</th>
            <th>Done</th>
            <th>Pending</th>
            <th>Total</th>
            <th>Completion</th>
          </tr>
        </thead>
        <tbody>
          ${phaseRows}
        </tbody>
      </table>
    </section>

    <section class="card">
      <h2>Archived Changes Timeline</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Phase</th>
            <th>Completed</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${archiveRows}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

async function main() {
  const [specText, changesText, archiveText] = await Promise.all([
    readFile(specPath, "utf8"),
    readFile(changesPath, "utf8"),
    readFile(archivePath, "utf8"),
  ]);

  const spec = parseSpec(specText);
  const changes = parseChanges(changesText);
  const archive = parseArchive(archiveText);
  const generatedAt = new Date().toISOString();

  const html = buildHtml({ spec, changes, archive, generatedAt });
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, html, "utf8");

  console.log("OpenSpec report generated");
  console.log(`- Output: ${path.relative(rootDir, reportPath)}`);
  console.log(`- Active changes: ${changes.activeChanges}`);
  console.log(`- Proposed: ${changes.proposed}`);
  console.log(`- In progress: ${changes.in_progress}`);
  console.log(`- Completed tasks: ${spec.checkedTasks}`);
  console.log(`- Pending tasks: ${spec.pendingTasks}`);
  console.log(`- Archived changes: ${archive.count}`);
}

main().catch((error) => {
  console.error("Failed to generate OpenSpec report");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
