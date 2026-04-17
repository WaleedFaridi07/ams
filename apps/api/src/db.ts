import { randomUUID } from "node:crypto";
import { Pool } from "pg";

export type AgentOutputMode = "text" | "json";

export type AgentRecord = {
  id: string;
  name: string;
  description: string;
  goal: string;
  systemPrompt: string;
  outputMode: AgentOutputMode;
  hasKnowledge: boolean;
  knowledgeOnly: boolean;
  internetEnabled: boolean;
  mcpEnabled: boolean;
  mcpUrl: string | null;
  mcpSecret: string | null;
  createdAt: string;
};

export type ChunkRecord = {
  id: string;
  agentId: string;
  text: string;
  embedding: number[];
};

export type AgentChildSummary = {
  id: string;
  name: string;
};

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }

    pool = new Pool({ connectionString: databaseUrl });
  }

  return pool;
}

function mapAgentRow(row: any): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    goal: row.goal,
    systemPrompt: row.system_prompt,
    outputMode: row.output_mode,
    hasKnowledge: row.has_knowledge,
    knowledgeOnly: row.knowledge_only,
    internetEnabled: row.internet_enabled,
    mcpEnabled: row.mcp_enabled,
    mcpUrl: row.mcp_url ?? null,
    mcpSecret: row.mcp_secret ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function mapChunkRow(row: any): ChunkRecord {
  const embedding: number[] = Array.isArray(row.embedding)
    ? row.embedding.map((value: unknown) => Number(value))
    : String(row.embedding)
        .replace("[", "")
        .replace("]", "")
        .split(",")
        .filter(Boolean)
        .map((value) => Number(value));

  return {
    id: row.id,
    agentId: row.agent_id,
    text: row.text,
    embedding,
  };
}

export async function initDatabase(): Promise<void> {
  const client = getPool();
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");

  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      goal TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      output_mode TEXT NOT NULL CHECK (output_mode IN ('text', 'json')),
      has_knowledge BOOLEAN NOT NULL DEFAULT FALSE,
      knowledge_only BOOLEAN NOT NULL DEFAULT FALSE,
      internet_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      mcp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      mcp_url TEXT,
      mcp_secret TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS knowledge_only BOOLEAN NOT NULL DEFAULT FALSE");
  await client.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS internet_enabled BOOLEAN NOT NULL DEFAULT TRUE");
  await client.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS mcp_enabled BOOLEAN NOT NULL DEFAULT FALSE");
  await client.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS mcp_url TEXT");
  await client.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS mcp_secret TEXT");

  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_children (
      parent_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      child_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (parent_agent_id, child_agent_id),
      CONSTRAINT agent_children_no_self CHECK (parent_agent_id <> child_agent_id)
    )
  `);
  await client.query(
    "CREATE INDEX IF NOT EXISTS agent_children_parent_idx ON agent_children(parent_agent_id)"
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS agent_children_child_idx ON agent_children(child_agent_id)"
  );

  await client.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      embedding VECTOR(6) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const userId = "00000000-0000-4000-8000-000000000001";
  await client.query(
    "INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [userId, "demo@ams.local"]
  );

  await client.query(
    `
      INSERT INTO agents (
        id,
        user_id,
        name,
        description,
        goal,
        system_prompt,
        output_mode,
        has_knowledge,
        knowledge_only,
        internet_enabled,
        mcp_enabled,
        mcp_url,
        mcp_secret
      )
      VALUES
        ('agent-support-001', $1, 'Support Assistant', 'Helps answer customer questions with concise steps.', 'Resolve user issues quickly and clearly.', 'You are a support assistant. Give short, practical answers and include step-by-step guidance when helpful.', 'text', FALSE, FALSE, TRUE, FALSE, NULL, NULL),
        ('agent-product-001', $1, 'Product Explainer', 'Turns product ideas into clear feature proposals.', 'Help product teams define MVP scope and user value.', 'You are a product expert. Clarify user outcomes, identify trade-offs, and provide a lightweight MVP plan.', 'text', FALSE, FALSE, TRUE, FALSE, NULL, NULL)
      ON CONFLICT (id) DO NOTHING
    `,
    [userId]
  );
}

export async function listAgents(): Promise<AgentRecord[]> {
  const result = await getPool().query("SELECT * FROM agents ORDER BY created_at DESC");
  return result.rows.map(mapAgentRow);
}

export async function getAgentById(agentId: string): Promise<AgentRecord | null> {
  const result = await getPool().query("SELECT * FROM agents WHERE id = $1", [agentId]);
  return result.rows[0] ? mapAgentRow(result.rows[0]) : null;
}

export async function listExistingAgentIds(ids: string[]): Promise<string[]> {
  if (!ids.length) {
    return [];
  }

  const result = await getPool().query("SELECT id FROM agents WHERE id = ANY($1::text[])", [ids]);
  return result.rows.map((row) => String(row.id));
}

export async function createAgent(agent: Omit<AgentRecord, "createdAt">): Promise<AgentRecord> {
  const userId = "00000000-0000-4000-8000-000000000001";
  const result = await getPool().query(
    `
      INSERT INTO agents (
        id,
        user_id,
        name,
        description,
        goal,
        system_prompt,
        output_mode,
        has_knowledge,
        knowledge_only,
        internet_enabled,
        mcp_enabled,
        mcp_url,
        mcp_secret
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `,
    [
      agent.id,
      userId,
      agent.name,
      agent.description,
      agent.goal,
      agent.systemPrompt,
      agent.outputMode,
      agent.hasKnowledge,
      agent.knowledgeOnly,
      agent.internetEnabled,
      agent.mcpEnabled,
      agent.mcpUrl,
      agent.mcpSecret,
    ]
  );

  return mapAgentRow(result.rows[0]);
}

export async function attachChildAgentsToParent(
  parentAgentId: string,
  childAgentIds: string[]
): Promise<void> {
  if (!childAgentIds.length) {
    return;
  }

  await getPool().query(
    `
      INSERT INTO agent_children (parent_agent_id, child_agent_id)
      SELECT $1, child_id
      FROM UNNEST($2::text[]) AS child_id
      ON CONFLICT (parent_agent_id, child_agent_id) DO NOTHING
    `,
    [parentAgentId, childAgentIds]
  );
}

export async function listChildAgentsByParentId(parentAgentId: string): Promise<AgentChildSummary[]> {
  const result = await getPool().query(
    `
      SELECT a.id, a.name
      FROM agent_children ac
      INNER JOIN agents a ON a.id = ac.child_agent_id
      WHERE ac.parent_agent_id = $1
      ORDER BY a.created_at DESC
    `,
    [parentAgentId]
  );

  return result.rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
}

export async function listChildAgentsByParentIds(
  parentAgentIds: string[]
): Promise<Record<string, AgentChildSummary[]>> {
  if (!parentAgentIds.length) {
    return {};
  }

  const result = await getPool().query(
    `
      SELECT ac.parent_agent_id, a.id AS child_id, a.name AS child_name
      FROM agent_children ac
      INNER JOIN agents a ON a.id = ac.child_agent_id
      WHERE ac.parent_agent_id = ANY($1::text[])
      ORDER BY a.created_at DESC
    `,
    [parentAgentIds]
  );

  const output: Record<string, AgentChildSummary[]> = {};
  for (const row of result.rows) {
    const parentId = String(row.parent_agent_id);
    if (!output[parentId]) {
      output[parentId] = [];
    }

    output[parentId].push({
      id: String(row.child_id),
      name: String(row.child_name),
    });
  }

  return output;
}

export async function updateAgentKnowledge(agentId: string, hasKnowledge: boolean): Promise<AgentRecord | null> {
  const result = await getPool().query(
    "UPDATE agents SET has_knowledge = $2 WHERE id = $1 RETURNING *",
    [agentId, hasKnowledge]
  );

  return result.rows[0] ? mapAgentRow(result.rows[0]) : null;
}

function toVectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value.toFixed(6))).join(",")}]`;
}

export async function insertChunks(agentId: string, values: Array<{ text: string; embedding: number[] }>): Promise<ChunkRecord[]> {
  const inserted: ChunkRecord[] = [];
  const client = getPool();

  for (const value of values) {
    const result = await client.query(
      "INSERT INTO chunks (id, agent_id, text, embedding) VALUES ($1, $2, $3, $4::vector) RETURNING *",
      [`chunk-${randomUUID()}`, agentId, value.text, toVectorLiteral(value.embedding)]
    );

    inserted.push(mapChunkRow(result.rows[0]));
  }

  return inserted;
}

export async function retrieveTopChunks(agentId: string, embedding: number[], topK: number): Promise<ChunkRecord[]> {
  const result = await getPool().query(
    `
      SELECT *
      FROM chunks
      WHERE agent_id = $1
      ORDER BY embedding <=> $2::vector
      LIMIT $3
    `,
    [agentId, toVectorLiteral(embedding), topK]
  );

  return result.rows.map(mapChunkRow);
}
