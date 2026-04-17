import express from "express";
import cors from "cors";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import dotenv from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import {
  attachChildAgentsToParent,
  createAgent as createAgentRecord,
  getAgentById as getAgentByIdRecord,
  initDatabase,
  insertChunks,
  listChildAgentsByParentId,
  listChildAgentsByParentIds,
  listExistingAgentIds,
  listAgents as listAgentsRecords,
  retrieveTopChunks as retrieveTopChunksByVector,
  type AgentChildSummary,
  type AgentOutputMode,
  type AgentRecord,
  type ChunkRecord,
  updateAgentKnowledge,
} from "./db";
import { embedBatch, embedText, getEmbeddingConfigSummary } from "./embedding";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

type Agent = Omit<AgentRecord, "mcpSecret"> & {
  childAgents: AgentChildSummary[];
};

type ChatResponse = string | Record<string, string>;

type McpInvocationResult = {
  attempted: boolean;
  success: boolean;
  serverUrl?: string;
  error?: string;
};

type DelegationResult = {
  attempted: boolean;
  selectedChildAgentId: string | null;
  selectedChildAgentName: string | null;
  success: boolean;
  latencyMs: number;
  reason: string;
  error?: string;
};

type JudgeJob = {
  traceId: string;
  agentId: string;
  agentName: string;
  userMessage: string;
  responseText: string;
  retrievedChunkCount: number;
  createdAt: string;
};

type AgentCreatorSkillOutput = {
  systemPrompt: string;
  constraints: string[];
  examplePrompts: string[];
  evaluationCases: string[];
};

type Chunk = ChunkRecord;
const uploadsDir = path.resolve(__dirname, "../../../data/uploads");

const app = express();
app.use(cors());
app.set("trust proxy", 1);
app.use(express.json({ limit: "25mb" }));

let langfuseClientPromise: Promise<any | null> | null = null;

class HttpError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

const createAgentSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  systemPrompt: z.string().trim().min(1),
  outputMode: z.enum(["text", "json"]).optional(),
  hasKnowledge: z.boolean().optional(),
  knowledgeOnly: z.boolean().optional(),
  internetEnabled: z.boolean().optional(),
  knowledgeFiles: z
    .array(
      z.object({
        fileName: z.string().trim().min(1),
        content: z.string().trim().min(1),
        contentEncoding: z.enum(["utf8", "base64"]).optional(),
        mimeType: z.string().optional(),
      })
    )
    .optional(),
  mcpEnabled: z.boolean().optional(),
  mcpUrl: z.string().trim().url().optional(),
  mcpSecret: z.string().trim().min(1).optional(),
  childAgentIds: z.array(z.string().trim().min(1)).max(10).optional(),
});

const chatSchema = z.object({
  agentId: z.string().trim().min(1),
  message: z.string().trim().min(1),
  useKnowledge: z.boolean().optional(),
  topK: z.number().int().positive().max(10).optional(),
});

const uploadSchema = z.object({
  agentId: z.string().trim().min(1),
  fileName: z.string().trim().min(1),
  content: z.string().trim().min(1),
  contentEncoding: z.enum(["utf8", "base64"]).optional(),
  mimeType: z.string().optional(),
});

const knowledgeToggleSchema = z.object({
  hasKnowledge: z.boolean(),
});

const skillSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  outputMode: z.enum(["text", "json"]).optional(),
});

const chunksQuerySchema = z.object({
  q: z.string().optional().default(""),
  k: z.coerce.number().int().positive().max(10).optional().default(4),
});

const weatherQuerySchema = z.object({
  city: z.string().trim().min(1),
  unit: z.enum(["c", "f"]).optional().default("c"),
});

const mcpTestSchema = z.object({
  url: z.string().trim().url(),
  secret: z.string().trim().min(1),
});

const feedbackSchema = z.object({
  traceId: z.string().trim().min(1),
  agentId: z.string().trim().min(1),
  score: z.union([z.literal(0), z.literal(1)]),
  comment: z.string().trim().max(500).optional(),
});

const feedbackMetricsQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).optional().default(30),
});

const childRouteSchema = z.object({
  selectedChildAgentId: z.string().trim().min(1).nullable(),
  reason: z.string().trim().min(1).max(160),
});

const judgeOutputSchema = z.object({
  overall: z.number(),
  reason: z.string().trim().min(1),
  dimensions: z.object({
    correctness: z.number(),
    relevance: z.number(),
    clarity: z.number(),
    actionability: z.number(),
  }),
});

function validateBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new HttpError(400, "Invalid request body", parsed.error.flatten());
  }

  return parsed.data;
}

function validateQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  const parsed = schema.safeParse(query);

  if (!parsed.success) {
    throw new HttpError(400, "Invalid query params", parsed.error.flatten());
  }

  return parsed.data;
}

async function enrichAgent(agent: AgentRecord): Promise<Agent> {
  const childAgents = await listChildAgentsByParentId(agent.id);
  return toPublicAgent(agent, childAgents);
}

async function enrichAgents(agents: AgentRecord[]): Promise<Agent[]> {
  const mapping = await listChildAgentsByParentIds(agents.map((agent) => agent.id));
  return agents.map((agent) => toPublicAgent(agent, mapping[agent.id] ?? []));
}

function toPublicAgent(agent: AgentRecord, childAgents: AgentChildSummary[] = []): Agent {
  const { mcpSecret: _secret, ...publicAgent } = agent;
  return {
    ...publicAgent,
    childAgents,
  };
}

async function getAgentById(agentId: string): Promise<Agent> {
  const agent = await getAgentRecordById(agentId);

  return enrichAgent(agent);
}

async function getAgentRecordById(agentId: string): Promise<AgentRecord> {
  const agent = await getAgentByIdRecord(agentId);

  if (!agent) {
    throw new HttpError(404, "Agent not found");
  }

  return agent;
}

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX ?? 120);
const configuredApiKey = process.env.API_ACCESS_KEY?.trim();
const demoMcpSharedSecret = (process.env.DEMO_MCP_SHARED_SECRET ?? "demo-mcp-secret").trim();
const enableChildOrchestration = process.env.ENABLE_CHILD_ORCHESTRATION !== "false";
const childRoutingMode = (process.env.CHILD_ROUTING_MODE ?? "llm_strict").trim().toLowerCase();
const ragTopKDefault = Math.max(1, Number(process.env.RAG_TOP_K ?? 4));
const ragMinSimilarity =
  process.env.RAG_MIN_SIMILARITY === undefined
    ? null
    : Number(process.env.RAG_MIN_SIMILARITY);
const ragChunkSize = Math.max(200, Number(process.env.RAG_CHUNK_SIZE ?? 500));
const ragChunkOverlap = Math.max(0, Number(process.env.RAG_CHUNK_OVERLAP ?? 100));
const enableLlmJudge = process.env.ENABLE_LLM_JUDGE === "true";
const llmJudgeModel = process.env.LLM_JUDGE_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const llmJudgeTimeoutMs = Number(process.env.LLM_JUDGE_TIMEOUT_MS ?? 8000);
const llmJudgeConcurrency = Math.max(1, Number(process.env.LLM_JUDGE_CONCURRENCY ?? 1));
const llmJudgeMaxQueue = Math.max(10, Number(process.env.LLM_JUDGE_MAX_QUEUE ?? 200));
const judgeQueue: JudgeJob[] = [];
let judgeRunningWorkers = 0;

const embeddingConfig = getEmbeddingConfigSummary();

app.use(
  rateLimit({
    windowMs: Number.isFinite(rateLimitWindowMs) ? rateLimitWindowMs : 60_000,
    max: Number.isFinite(rateLimitMax) ? rateLimitMax : 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "Too many requests" });
    },
  })
);

if (configuredApiKey) {
  app.use((req, _res, next) => {
    if (req.method === "OPTIONS" || req.path === "/health") {
      next();
      return;
    }

    const apiKey = req.header("x-api-key");

    if (apiKey !== configuredApiKey) {
      next(new HttpError(401, "Unauthorized"));
      return;
    }

    next();
  });
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeCity(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|\s)\S/g, (match) => match.toUpperCase());
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function buildMockWeather(cityInput: string, unit: "c" | "f") {
  const city = normalizeCity(cityInput);
  const hash = hashString(city.toLowerCase());
  const conditions = [
    "Sunny",
    "Partly cloudy",
    "Cloudy",
    "Light rain",
    "Windy",
    "Foggy",
    "Scattered showers",
  ];
  const temperatureC = (hash % 36) - 5;
  const convertedTemp =
    unit === "f" ? Math.round((temperatureC * 9) / 5 + 32) : temperatureC;

  return {
    city,
    temperature: convertedTemp,
    unit,
    condition: conditions[hash % conditions.length],
    updatedAt: new Date().toISOString(),
  };
}

function extractCityFromMessage(message: string): string {
  const inMatch = message.match(/\bin\s+([a-zA-Z][a-zA-Z\s-]{1,40})/i);
  if (inMatch?.[1]) {
    const cleaned = inMatch[1].replace(/\b(today|now|tomorrow|please)\b/gi, "").trim();
    if (cleaned) {
      return normalizeCity(cleaned);
    }
  }

  const capitalized = message.match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/);
  if (capitalized?.[1]) {
    return normalizeCity(capitalized[1]);
  }

  return "Berlin";
}

function getBearerToken(req: Request): string {
  const value = req.header("authorization") ?? "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function assertDemoMcpAuthorized(req: Request): void {
  const token = getBearerToken(req);
  if (!token || token !== demoMcpSharedSecret) {
    throw new HttpError(401, "Unauthorized MCP access");
  }
}

async function callMcpJsonRpc(
  serverUrl: string,
  secret: string,
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const response = await fetch(serverUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
      ...(configuredApiKey ? { "x-api-key": configuredApiKey } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`MCP HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: unknown;
    error?: { message?: string };
  };

  if (payload.error) {
    throw new Error(payload.error.message ?? "MCP RPC failed");
  }

  return payload.result;
}

async function invokeAgentMcp(agent: AgentRecord, message: string): Promise<{
  chunk?: Chunk;
  invocation: McpInvocationResult;
}> {
  if (!agent.mcpEnabled || !agent.mcpUrl || !agent.mcpSecret) {
    return {
      invocation: {
        attempted: false,
        success: false,
      },
    };
  }

  try {
    const listResult = (await callMcpJsonRpc(agent.mcpUrl, agent.mcpSecret, "tools/list", {})) as
      | { tools?: Array<{ name?: string }> }
      | undefined;

    const hasWeatherTool = (listResult?.tools ?? []).some((tool) => tool?.name === "get_weather");
    if (!hasWeatherTool) {
      throw new Error("MCP tool 'get_weather' not found");
    }

    const city = extractCityFromMessage(message);
    const callResult = await callMcpJsonRpc(agent.mcpUrl, agent.mcpSecret, "tools/call", {
      name: "get_weather",
      arguments: {
        city,
        unit: "c",
      },
    });

    const text = typeof callResult === "string" ? callResult : JSON.stringify(callResult);

    return {
      chunk: {
        id: `mcp-${randomUUID()}`,
        agentId: agent.id,
        text: `[MCP get_weather] ${text}`,
        embedding: createMockEmbedding(text),
      },
      invocation: {
        attempted: true,
        success: true,
        serverUrl: agent.mcpUrl,
      },
    };
  } catch (error) {
    return {
      invocation: {
        attempted: true,
        success: false,
        serverUrl: agent.mcpUrl,
        error: error instanceof Error ? error.message : "MCP invocation failed",
      },
    };
  }
}

const ROUTER_SYSTEM_PROMPT = [
  "You are a strict routing controller for a parent agent.",
  "Your task is to select AT MOST ONE child agent from the allowed list.",
  "Return JSON only.",
  "selectedChildAgentId must be one allowed child id or null.",
  "If confidence is low, choose null.",
  "Never invent IDs.",
  "Keep reason concise.",
].join(" ");

const ROUTER_HUMAN_TEMPLATE = [
  "Parent agent:",
  "- id: {parentAgentId}",
  "- name: {parentAgentName}",
  "- goal: {parentGoal}",
  "- systemPrompt: {parentSystemPrompt}",
  "",
  "Allowed child agents:",
  "{childAgentsList}",
  "",
  "User message:",
  "{userMessage}",
  "",
  "Return JSON exactly: {{\"selectedChildAgentId\": null, \"reason\": \"string\"}}",
].join("\n");

const PARENT_SYNTHESIS_SYSTEM_PROMPT = [
  "You are the parent orchestrator agent.",
  "You may use delegated child output as evidence, but produce one unified final answer.",
  "Do not expose routing internals unless asked.",
  "If child output exists, incorporate it naturally.",
  "If no child was used, continue with a direct answer.",
  "Be concise, practical, and avoid fabricated facts.",
].join(" ");

const PARENT_SYNTHESIS_HUMAN_TEMPLATE = [
  "Parent profile:",
  "- id: {parentAgentId}",
  "- name: {parentAgentName}",
  "- goal: {parentGoal}",
  "- systemPrompt: {parentSystemPrompt}",
  "",
  "User message:",
  "{userMessage}",
  "",
  "Delegation summary:",
  "- attempted: {delegationAttempted}",
  "- selectedChildAgentId: {selectedChildAgentId}",
  "- selectedChildAgentName: {selectedChildAgentName}",
  "- success: {delegationSuccess}",
  "- reason: {delegationReason}",
  "- error: {delegationError}",
  "",
  "Parent context:",
  "{parentContextText}",
  "",
  "Child output (optional):",
  "{childOutputText}",
  "",
  "Produce the final user-facing answer now.",
].join("\n");

function formatChildAgentsList(childAgents: AgentChildSummary[]): string {
  if (!childAgents.length) {
    return "- (none)";
  }

  return [...childAgents]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((child) => `- id: ${child.id} | name: ${child.name}`)
    .join("\n");
}

function allowedChildIds(childAgents: AgentChildSummary[]): string[] {
  return [...new Set(childAgents.map((child) => child.id))];
}

function validateChildRouteAgainstAllowed(
  route: z.infer<typeof childRouteSchema>,
  allowedIds: string[]
): z.infer<typeof childRouteSchema> {
  if (!route.selectedChildAgentId) {
    return route;
  }

  if (!allowedIds.includes(route.selectedChildAgentId)) {
    return {
      selectedChildAgentId: null,
      reason: "Router selected invalid child id; falling back to parent-only response",
    };
  }

  return route;
}

function heuristicRouteChild(
  childAgents: AgentChildSummary[],
  userMessage: string
): z.infer<typeof childRouteSchema> {
  const text = userMessage.toLowerCase();
  const scored = childAgents.map((child) => {
    const name = child.name.toLowerCase();
    let score = 0;

    if (name.includes("api") && /(\bapi\b|query\s*ci|endpoint|service\s*status|request)/.test(text)) {
      score += 3;
    }
    if (name.includes("weather") && /(weather|forecast|temperature|rain|wind|humidity)/.test(text)) {
      score += 3;
    }

    if (name.includes("product") && /(mvp|roadmap|feature|product|plan)/.test(text)) {
      score += 2;
    }
    if (name.includes("support") && /(issue|error|help|support|reset|fix)/.test(text)) {
      score += 2;
    }

    const tokens = name.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (token.length >= 3 && text.includes(token)) {
        score += 1;
      }
    }

    return { child, score };
  });

  scored.sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score <= 0) {
    return {
      selectedChildAgentId: null,
      reason: "No strong child-agent match by heuristic routing",
    };
  }

  return {
    selectedChildAgentId: scored[0].child.id,
    reason: `Heuristic routing selected ${scored[0].child.name}`,
  };
}

async function routeChild(input: {
  parentAgent: Agent;
  childAgents: AgentChildSummary[];
  userMessage: string;
}): Promise<z.infer<typeof childRouteSchema>> {
  const ids = allowedChildIds(input.childAgents);
  if (!ids.length || !enableChildOrchestration) {
    return {
      selectedChildAgentId: null,
      reason: "No eligible child agents configured",
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    if (childRoutingMode === "hybrid") {
      return heuristicRouteChild(input.childAgents, input.userMessage);
    }

    return {
      selectedChildAgentId: null,
      reason: "LLM routing unavailable (OPENAI_API_KEY missing)",
    };
  }

  try {
    const [{ ChatOpenAI }, { ChatPromptTemplate }] = await Promise.all([
      import("@langchain/openai"),
      import("@langchain/core/prompts"),
    ]);

    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.ROUTER_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0,
    });

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", ROUTER_SYSTEM_PROMPT],
      ["human", ROUTER_HUMAN_TEMPLATE],
    ]);

    const chain = prompt.pipe(model);
    const routeResult = await chain.invoke({
      parentAgentId: input.parentAgent.id,
      parentAgentName: input.parentAgent.name,
      parentGoal: input.parentAgent.goal,
      parentSystemPrompt: input.parentAgent.systemPrompt,
      childAgentsList: formatChildAgentsList(input.childAgents),
      userMessage: input.userMessage,
    });

    const routeText =
      typeof routeResult.content === "string"
        ? routeResult.content
        : Array.isArray(routeResult.content)
          ? routeResult.content
              .map((item) => {
                if (typeof item === "string") {
                  return item;
                }

                if (
                  item &&
                  typeof item === "object" &&
                  "type" in item &&
                  (item as { type?: unknown }).type === "text" &&
                  "text" in item
                ) {
                  return String((item as { text?: unknown }).text ?? "");
                }

                return JSON.stringify(item);
              })
              .join("\n")
          : JSON.stringify(routeResult.content ?? "{}");

    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(routeText);
    } catch {
      const firstBrace = routeText.indexOf("{");
      const lastBrace = routeText.lastIndexOf("}");
      if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
        throw new Error("Router JSON parse failed");
      }
      parsedRaw = JSON.parse(routeText.slice(firstBrace, lastBrace + 1));
    }

    const normalizedRaw =
      parsedRaw && typeof parsedRaw === "object"
        ? {
            ...(parsedRaw as Record<string, unknown>),
            selectedChildAgentId:
              (parsedRaw as { selectedChildAgentId?: unknown }).selectedChildAgentId === "null"
                ? null
                : (parsedRaw as { selectedChildAgentId?: unknown }).selectedChildAgentId,
          }
        : parsedRaw;

    const validated = childRouteSchema.safeParse(normalizedRaw);
    if (!validated.success) {
      throw new Error("Router schema validation failed");
    }

    const route = validated.data;

    return validateChildRouteAgainstAllowed(route, ids);
  } catch (error) {
    if (childRoutingMode === "hybrid") {
      return heuristicRouteChild(input.childAgents, input.userMessage);
    }

    return {
      selectedChildAgentId: null,
      reason: `LLM routing failed; parent handles directly (${error instanceof Error ? error.message : "unknown"})`,
    };
  }
}

async function invokeChildAgent(input: {
  childAgentId: string;
  userMessage: string;
  topK: number;
  useKnowledge: boolean;
}): Promise<{ text: string; provider: "langchain" | "mock"; retrievedChunkCount: number }> {
  const childRecord = await getAgentRecordById(input.childAgentId);
  const child = await enrichAgent(childRecord);

  const useKnowledge = child.knowledgeOnly ? true : input.useKnowledge ?? child.hasKnowledge;
  const topK = Math.max(1, Math.min(10, input.topK));
  const retrievedChunks = useKnowledge
    ? await retrieveTopChunks(child.id, input.userMessage, topK)
    : [];
  const mcp = await invokeAgentMcp(childRecord, input.userMessage);
  const effectiveChunks = mcp.chunk ? [...retrievedChunks, mcp.chunk] : retrievedChunks;

  let langChainResponse: ChatResponse | null = null;
  try {
    langChainResponse = await buildLangChainReply(child, input.userMessage, effectiveChunks);
  } catch {
    langChainResponse = null;
  }

  const response = langChainResponse ?? buildMockAgentReply(child, input.userMessage, effectiveChunks);
  const text = typeof response === "string" ? response : JSON.stringify(response);

  return {
    text,
    provider: langChainResponse ? "langchain" : "mock",
    retrievedChunkCount: effectiveChunks.length,
  };
}

async function synthesizeParentResponse(input: {
  parentAgent: Agent;
  userMessage: string;
  parentContextText: string;
  childOutputText?: string;
  delegation: DelegationResult;
}): Promise<{ response: ChatResponse; provider: "langchain" | "mock" }> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      provider: "mock",
      response: buildMockAgentReply(
        input.parentAgent,
        input.userMessage,
        input.childOutputText
          ? [
              {
                id: `synthetic-${randomUUID()}`,
                agentId: input.parentAgent.id,
                text: `[Child output] ${input.childOutputText}`,
                embedding: createMockEmbedding(input.childOutputText),
              },
            ]
          : []
      ),
    };
  }

  try {
    const [{ ChatOpenAI }, { ChatPromptTemplate }] = await Promise.all([
      import("@langchain/openai"),
      import("@langchain/core/prompts"),
    ]);

    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.2,
    });

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", PARENT_SYNTHESIS_SYSTEM_PROMPT],
      ["human", PARENT_SYNTHESIS_HUMAN_TEMPLATE],
    ]);

    const chain = prompt.pipe(model);
    const result = await chain.invoke({
      parentAgentId: input.parentAgent.id,
      parentAgentName: input.parentAgent.name,
      parentGoal: input.parentAgent.goal,
      parentSystemPrompt: input.parentAgent.systemPrompt,
      userMessage: input.userMessage,
      delegationAttempted: String(input.delegation.attempted),
      selectedChildAgentId: input.delegation.selectedChildAgentId ?? "null",
      selectedChildAgentName: input.delegation.selectedChildAgentName ?? "null",
      delegationSuccess: String(input.delegation.success),
      delegationReason: input.delegation.reason,
      delegationError: input.delegation.error ?? "none",
      parentContextText: input.parentContextText || "No retrieved context.",
      childOutputText: input.childOutputText ?? "No child output.",
    });

    const text = typeof result.content === "string" ? result.content : JSON.stringify(result.content);

    if (input.parentAgent.outputMode === "json") {
      return {
        provider: "langchain",
        response: {
          answer: text,
          delegation: JSON.stringify({
            selectedChildAgentId: input.delegation.selectedChildAgentId,
            selectedChildAgentName: input.delegation.selectedChildAgentName,
            success: input.delegation.success,
            reason: input.delegation.reason,
          }),
          context: input.parentContextText,
        },
      };
    }

    return {
      provider: "langchain",
      response: text,
    };
  } catch {
    return {
      provider: "mock",
      response: buildMockAgentReply(input.parentAgent, input.userMessage, []),
    };
  }
}

async function orchestrateParentTurn(input: {
  parentAgentRecord: AgentRecord;
  userMessage: string;
  useKnowledge: boolean;
  topK: number;
}): Promise<{
  response: ChatResponse;
  provider: "langchain" | "mock";
  retrievedChunks: Chunk[];
  mcpInvocation: McpInvocationResult;
  delegation: DelegationResult;
}> {
  const parent = await enrichAgent(input.parentAgentRecord);
  const retrievedChunks = input.useKnowledge
    ? await retrieveTopChunks(parent.id, input.userMessage, input.topK)
    : [];
  const mcp = await invokeAgentMcp(input.parentAgentRecord, input.userMessage);
  const parentBaseChunks = mcp.chunk ? [...retrievedChunks, mcp.chunk] : retrievedChunks;

  const delegation: DelegationResult = {
    attempted: Boolean(enableChildOrchestration && parent.childAgents.length),
    selectedChildAgentId: null,
    selectedChildAgentName: null,
    success: true,
    latencyMs: 0,
    reason: parent.childAgents.length ? "Routing not executed" : "No child agents configured",
  };

  let childOutputText: string | null = null;

  if (delegation.attempted) {
    const started = Date.now();
    try {
      const route = await routeChild({
        parentAgent: parent,
        childAgents: parent.childAgents,
        userMessage: input.userMessage,
      });

      delegation.reason = route.reason;
      delegation.selectedChildAgentId = route.selectedChildAgentId;

      if (route.selectedChildAgentId) {
        const selected = parent.childAgents.find((child) => child.id === route.selectedChildAgentId);
        if (!selected) {
          throw new Error("Selected child is not configured");
        }

        delegation.selectedChildAgentName = selected.name;
        const childOutput = await invokeChildAgent({
          childAgentId: selected.id,
          userMessage: input.userMessage,
          topK: input.topK,
          useKnowledge: true,
        });

        childOutputText = childOutput.text;
      }
    } catch (error) {
      delegation.success = false;
      delegation.error = error instanceof Error ? error.message : "Child invocation failed";
      delegation.reason = "Child invocation failed; fallback to parent response";
    } finally {
      delegation.latencyMs = Date.now() - started;
    }
  }

  const effectiveChunks = [...parentBaseChunks];
  if (childOutputText) {
    effectiveChunks.push({
      id: `child-${randomUUID()}`,
      agentId: parent.id,
      text: `[Child ${delegation.selectedChildAgentName ?? "agent"}] ${childOutputText}`,
      embedding: createMockEmbedding(childOutputText),
    });
  }

  const synthesis = await synthesizeParentResponse({
    parentAgent: parent,
    userMessage: input.userMessage,
    parentContextText: buildContextText(effectiveChunks),
    childOutputText: childOutputText ?? undefined,
    delegation,
  });

  return {
    response: synthesis.response,
    provider: synthesis.provider,
    retrievedChunks: effectiveChunks,
    mcpInvocation: mcp.invocation,
    delegation,
  };
}

function outputModeInstruction(outputMode: AgentOutputMode): string {
  if (outputMode === "json") {
    return "Return valid JSON only. Do not wrap with markdown code fences.";
  }

  return "Return concise plain text with clear sections when needed.";
}

function createAgentSkillOutput(input: {
  name: string;
  description: string;
  goal: string;
  outputMode: AgentOutputMode;
}): AgentCreatorSkillOutput {
  const name = normalizeText(input.name);
  const description = normalizeText(input.description);
  const goal = normalizeText(input.goal);

  const systemPrompt = [
    `You are ${name}.`,
    `Role description: ${description}`,
    `Primary goal: ${goal}`,
    outputModeInstruction(input.outputMode),
    "Be direct, practical, and avoid invented facts.",
    "If requirements are unclear, ask one focused clarifying question.",
  ].join(" ");

  return {
    systemPrompt,
    constraints: [
      "Stay aligned to the stated goal and user intent.",
      "Do not claim actions you did not perform.",
      "Prefer short actionable steps over long explanations.",
      outputModeInstruction(input.outputMode),
    ],
    examplePrompts: [
      `Help me with this as ${name}: draft a first solution for the goal '${goal}'.`,
      `Act as ${name} and suggest a minimal MVP plan based on: ${description}.`,
      `Use ${name} style and produce a step-by-step response for this task.`,
    ],
    evaluationCases: [
      "Given a vague user request, asks one high-value clarifying question.",
      "Given a clear request, returns a direct answer aligned with the goal.",
      `Given outputMode='${input.outputMode}', follows output format constraints.`,
    ],
  };
}

async function getLangfuseClient(): Promise<any | null> {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    return null;
  }

  if (!langfuseClientPromise) {
    langfuseClientPromise = (async () => {
      const { Langfuse } = await import("langfuse");
      return new Langfuse({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY,
        secretKey: process.env.LANGFUSE_SECRET_KEY,
        baseUrl: process.env.LANGFUSE_BASE_URL ?? "http://localhost:3000",
      });
    })();
  }

  return langfuseClientPromise;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizeChatResponseText(response: ChatResponse): string {
  return typeof response === "string" ? response : JSON.stringify(response);
}

async function runLlmJudge(job: JudgeJob): Promise<z.infer<typeof judgeOutputSchema> | null> {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const [{ ChatOpenAI }, { ChatPromptTemplate }] = await Promise.all([
    import("@langchain/openai"),
    import("@langchain/core/prompts"),
  ]);

  const model = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: llmJudgeModel,
    temperature: 0,
  });
  const judgeModel = model.withStructuredOutput(judgeOutputSchema);

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      [
        "You are an impartial response judge.",
        "Score the assistant response from 0 to 1 on: correctness, relevance, clarity, actionability.",
        "Return JSON only with keys: overall, reason, dimensions.correctness, dimensions.relevance, dimensions.clarity, dimensions.actionability.",
        "Keep reason under 160 characters.",
      ].join(" "),
    ],
    [
      "human",
      [
        `Agent: ${job.agentName} (${job.agentId})`,
        `User message: ${job.userMessage}`,
        `Assistant response: ${job.responseText}`,
        `Retrieved chunk count: ${job.retrievedChunkCount}`,
      ].join("\n"),
    ],
  ]);

  const chain = prompt.pipe(judgeModel);
  const invokePromise = chain.invoke({});
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("LLM judge timeout")), llmJudgeTimeoutMs);
  });
  const result = await Promise.race([invokePromise, timeoutPromise]);

  const validated = judgeOutputSchema.safeParse(result);
  if (!validated.success) {
    return null;
  }

  const normalized = {
    overall: clampUnit(validated.data.overall),
    reason: validated.data.reason,
    dimensions: {
      correctness: clampUnit(validated.data.dimensions.correctness),
      relevance: clampUnit(validated.data.dimensions.relevance),
      clarity: clampUnit(validated.data.dimensions.clarity),
      actionability: clampUnit(validated.data.dimensions.actionability),
    },
  };

  const average = Number(
    (
      (normalized.dimensions.correctness +
        normalized.dimensions.relevance +
        normalized.dimensions.clarity +
        normalized.dimensions.actionability) /
      4
    ).toFixed(3)
  );

  return {
    ...normalized,
    overall: Number(((normalized.overall + average) / 2).toFixed(3)),
  };
}

async function recordJudgeScore(input: {
  traceId: string;
  agentId: string;
  agentName: string;
  judgeResult: z.infer<typeof judgeOutputSchema>;
}): Promise<void> {
  const client = await getLangfuseClient();
  if (!client?.api?.scoreCreate) {
    return;
  }

  await client.api.scoreCreate({
    traceId: input.traceId,
    name: "judge_quality",
    value: input.judgeResult.overall,
    dataType: "NUMERIC",
    comment: input.judgeResult.reason,
    metadata: {
      agentId: input.agentId,
      agentName: input.agentName,
      source: "llm_judge_async",
      model: llmJudgeModel,
      dimensions: input.judgeResult.dimensions,
    },
  });

  await client.flushAsync?.();
}

async function processJudgeQueue(): Promise<void> {
  while (judgeRunningWorkers < llmJudgeConcurrency && judgeQueue.length > 0) {
    const nextJob = judgeQueue.shift();
    if (!nextJob) {
      return;
    }

    judgeRunningWorkers += 1;
    (async () => {
      try {
        const judged = await runLlmJudge(nextJob);
        if (judged) {
          await recordJudgeScore({
            traceId: nextJob.traceId,
            agentId: nextJob.agentId,
            agentName: nextJob.agentName,
            judgeResult: judged,
          });
        }
      } catch {
        // ignore async judge failures for demo stability
      } finally {
        judgeRunningWorkers -= 1;
        void processJudgeQueue();
      }
    })();
  }
}

function enqueueJudgeJob(job: JudgeJob): void {
  if (!enableLlmJudge) {
    return;
  }

  if (judgeQueue.length >= llmJudgeMaxQueue) {
    judgeQueue.shift();
  }

  judgeQueue.push(job);
  void processJudgeQueue();
}

async function recordTrace(
  name: string,
  input: unknown,
  output: unknown,
  error?: string,
  metadata?: Record<string, unknown>,
  tags?: string[]
): Promise<string | null> {
  try {
    const client = await getLangfuseClient();

    if (!client) {
      return null;
    }

    const traceId = randomUUID();

    client.trace?.({
      id: traceId,
      name,
      input,
      output,
      tags,
      metadata:
        error || metadata
          ? {
              ...(metadata ?? {}),
              ...(error ? { error } : {}),
            }
          : undefined,
    });

    await client.flushAsync?.();
    return traceId;
  } catch (_traceError) {
    return null;
  }
}

async function listAgentScores(input: {
  fromTimestamp: string;
  scoreName: "user_feedback" | "judge_quality";
  dataType: "BOOLEAN" | "NUMERIC";
}): Promise<Array<{ value: number; agentId: string }>> {
  const client = await getLangfuseClient();

  if (!client?.api?.scoreV2Get) {
    return [];
  }

  const scores: Array<{ value: number; agentId: string }> = [];
  const limit = 100;

  for (let page = 1; page <= 20; page += 1) {
    const result = await client.api.scoreV2Get({
      page,
      limit,
      name: input.scoreName,
      dataType: input.dataType,
      fromTimestamp: input.fromTimestamp,
    });

    const data = Array.isArray(result?.data) ? result.data : [];
    for (const item of data) {
      const numeric = typeof item.value === "number" ? item.value : Number(item.value);
      const scoreAgentId =
        typeof (item as { metadata?: { agentId?: unknown } }).metadata?.agentId === "string"
          ? String((item as { metadata?: { agentId?: unknown } }).metadata?.agentId)
          : "";

      if (Number.isFinite(numeric) && scoreAgentId) {
        scores.push({ value: numeric, agentId: scoreAgentId });
      }
    }

    const totalPages = Number(result?.meta?.totalPages ?? page);
    if (page >= totalPages || data.length === 0) {
      break;
    }
  }

  return scores;
}

async function recordScore(input: {
  traceId: string;
  agentId: string;
  agentName?: string;
  score: 0 | 1;
  comment?: string;
}): Promise<boolean> {
  try {
    const client = await getLangfuseClient();

    if (!client?.api?.scoreCreate) {
      return false;
    }

    await client.api.scoreCreate({
      traceId: input.traceId,
      name: "user_feedback",
      value: input.score,
      comment: input.comment,
      dataType: "BOOLEAN",
      metadata: {
        agentId: input.agentId,
        agentName: input.agentName ?? null,
        source: "ui_thumbs",
      },
    });

    await client.flushAsync?.();
    return true;
  } catch {
    return false;
  }
}

function buildContextText(retrievedChunks: Chunk[]): string {
  if (!retrievedChunks.length) {
    return "No retrieved context.";
  }

  return retrievedChunks.map((chunk, index) => `[${index + 1}] ${chunk.text}`).join("\n");
}

function buildMockAgentReply(agent: Agent, message: string, retrievedChunks: Chunk[]): ChatResponse {
  const contextText = buildContextText(retrievedChunks);

  if (agent.outputMode === "json") {
    return {
      answer: `Using ${agent.name}, here is a first-pass response to: ${message}`,
      guidance: agent.systemPrompt,
      context: contextText,
    };
  }

  return [
    `Agent: ${agent.name}`,
    `System Prompt Applied: ${agent.systemPrompt}`,
    `Retrieved Context:\n${contextText}`,
    `User Message: ${message}`,
    "Draft Response: This is a mock reply routed through the selected agent prompt.",
  ].join("\n");
}

async function buildLangChainReply(
  agent: Agent,
  message: string,
  retrievedChunks: Chunk[]
): Promise<ChatResponse | null> {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const [{ ChatOpenAI }, { ChatPromptTemplate }] = await Promise.all([
    import("@langchain/openai"),
    import("@langchain/core/prompts"),
  ]);

  const model = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0.2,
  });

  const contextText = buildContextText(retrievedChunks);
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "{systemPrompt}"],
    ["human", "{userMessage}"],
  ]);

  const chain = prompt.pipe(model);
  const modelResult = await chain.invoke({
    systemPrompt: [
      agent.systemPrompt,
      agent.internetEnabled
        ? "Internet browsing is allowed if needed."
        : "Internet browsing is disabled. Do not use external sources.",
      agent.knowledgeOnly
        ? "Use only the retrieved context for factual answers. If context is missing or weak, say that attached files do not provide enough information. Do not guess."
        : "Retrieved context is optional support.",
      "When referencing retrieved context, cite short markers like [1], [2] where relevant.",
      "Use the following retrieved context if relevant:",
      contextText,
    ].join("\n\n"),
    userMessage: message,
  });

  const outputText =
    typeof modelResult.content === "string"
      ? modelResult.content
      : JSON.stringify(modelResult.content);

  if (agent.outputMode === "json") {
    return {
      answer: outputText,
      guidance: "Generated with LangChain + OpenAI adapter",
      context: contextText,
    };
  }

  return outputText;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function sanitizeExtractedText(value: string): string {
  return value.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
}

async function extractTextFromUpload(input: {
  content: string;
  contentEncoding?: "utf8" | "base64";
  fileName: string;
  mimeType?: string;
}): Promise<string> {
  const encoding = input.contentEncoding ?? "utf8";
  const isPdf =
    input.mimeType === "application/pdf" || input.fileName.toLowerCase().endsWith(".pdf");

  const buffer =
    encoding === "base64"
      ? Buffer.from(input.content, "base64")
      : Buffer.from(input.content, "utf8");

  if (isPdf) {
    try {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const parsed = await parser.getText();
      await parser.destroy();
      return sanitizeExtractedText(parsed.text ?? "");
    } catch {
      throw new HttpError(400, "Unable to read PDF content. Please upload a valid PDF.");
    }
  }

  if (encoding === "base64") {
    return sanitizeExtractedText(buffer.toString("utf8"));
  }

  return sanitizeExtractedText(input.content);
}

async function persistKnowledgeFiles(
  agentId: string,
  files: Array<{
    fileName: string;
    content: string;
    contentEncoding?: "utf8" | "base64";
    mimeType?: string;
  }>
): Promise<{ storedFiles: string[]; createdChunks: Chunk[] }> {
  const storedFiles: string[] = [];
  const textsToEmbed: string[] = [];

  await mkdir(uploadsDir, { recursive: true });

  for (const file of files) {
    const extractedText = await extractTextFromUpload({
      content: file.content,
      contentEncoding: file.contentEncoding,
      fileName: file.fileName,
      mimeType: file.mimeType,
    });

    if (!extractedText) {
      continue;
    }

    const safeFileName = `${Date.now()}-${sanitizeFileName(file.fileName)}`;
    const filePath = path.join(uploadsDir, safeFileName);
    await writeFile(filePath, extractedText, "utf8");
    storedFiles.push(filePath);

    const textChunks = chunkText(extractedText, ragChunkSize, ragChunkOverlap);
    textsToEmbed.push(...textChunks);
  }

  if (!storedFiles.length) {
    throw new HttpError(
      400,
      "No readable text found in attached files. Please upload text-based files."
    );
  }

  const embeddings = textsToEmbed.length ? await embedBatch(textsToEmbed) : [];
  const chunkPayloads = textsToEmbed.map((text, index) => ({
    text,
    embedding: embeddings[index] ?? createMockEmbedding(text),
  }));
  const createdChunks = chunkPayloads.length ? await insertChunks(agentId, chunkPayloads) : [];
  return { storedFiles, createdChunks };
}

function chunkText(text: string, size = 500, overlap = 100): string[] {
  if (text.length <= size) {
    return [text];
  }

  const output: string[] = [];
  const step = Math.max(1, size - Math.max(0, Math.min(overlap, size - 1)));

  for (let index = 0; index < text.length; index += step) {
    output.push(text.slice(index, index + size));
    if (index + size >= text.length) {
      break;
    }
  }

  return output;
}

function createMockEmbedding(text: string): number[] {
  const vector = [0, 0, 0, 0, 0, 0];

  for (let index = 0; index < text.length; index += 1) {
    const charCode = text.charCodeAt(index);
    vector[index % vector.length] += charCode;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}

async function retrieveTopChunks(agentId: string, query: string, topK: number): Promise<Chunk[]> {
  const queryEmbedding = await embedText(query);
  const chunks = await retrieveTopChunksByVector(agentId, queryEmbedding, topK);

  if (ragMinSimilarity !== null && Number.isFinite(ragMinSimilarity)) {
    return chunks.filter((chunk) => (chunk.similarity ?? -1) >= Number(ragMinSimilarity));
  }

  return chunks;
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get(
  "/demo/weather",
  asyncHandler(async (req, res) => {
    const query = validateQuery(weatherQuerySchema, req.query);
    const weather = buildMockWeather(query.city, query.unit);
    res.json(weather);
  })
);

app.post(
  "/demo/mcp",
  asyncHandler(async (req, res) => {
    assertDemoMcpAuthorized(req);

    const requestBody = req.body as {
      id?: string | number | null;
      method?: string;
      params?: Record<string, unknown>;
    };
    const requestId = requestBody.id ?? null;
    const method = String(requestBody.method ?? "");

    if (method === "initialize") {
      res.json({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: "ams-demo-mcp",
            version: "1.0.0",
          },
          capabilities: {
            tools: {},
          },
        },
      });
      return;
    }

    if (method === "tools/list") {
      res.json({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          tools: [
            {
              name: "get_weather",
              description: "Get mock weather by city",
              inputSchema: {
                type: "object",
                properties: {
                  city: { type: "string", description: "City name" },
                  unit: { type: "string", enum: ["c", "f"], default: "c" },
                },
                required: ["city"],
              },
            },
          ],
        },
      });
      return;
    }

    if (method === "tools/call") {
      const params = (requestBody.params ?? {}) as {
        name?: string;
        arguments?: Record<string, unknown>;
      };

      if (params.name !== "get_weather") {
        throw new HttpError(400, "Unknown tool name");
      }

      const args = params.arguments ?? {};
      const city = String(args.city ?? "").trim();
      const unitRaw = String(args.unit ?? "c").toLowerCase();
      const unit = unitRaw === "f" ? "f" : "c";

      if (!city) {
        throw new HttpError(400, "Tool argument 'city' is required");
      }

      const weather = buildMockWeather(city, unit);

      res.json({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          content: [
            {
              type: "text",
              text: `Weather in ${weather.city}: ${weather.temperature}${weather.unit.toUpperCase()}, ${weather.condition}`,
            },
          ],
          structuredContent: weather,
        },
      });
      return;
    }

    res.json({
      jsonrpc: "2.0",
      id: requestId,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    });
  })
);

app.post(
  "/mcp/test",
  asyncHandler(async (req, res) => {
    const payload = validateBody(mcpTestSchema, req.body);

    const result = (await callMcpJsonRpc(payload.url, payload.secret, "tools/list", {})) as
      | { tools?: Array<{ name?: string }> }
      | undefined;

    const tools = (result?.tools ?? []).map((tool) => String(tool.name ?? "")).filter(Boolean);

    res.json({
      ok: true,
      toolCount: tools.length,
      tools,
    });
  })
);

app.get(
  "/agents",
  asyncHandler(async (_req, res) => {
    const agents = await enrichAgents(await listAgentsRecords());
    res.json({ agents });
  })
);

app.get(
  "/agents/:id",
  asyncHandler(async (req, res) => {
    const agent = await getAgentById(String(req.params.id));
    res.json({ agent });
  })
);

app.post(
  "/agents",
  asyncHandler(async (req, res) => {
    const payload = validateBody(createAgentSchema, req.body);

    const outputMode = payload.outputMode ?? "text";
    const hasKnowledge = payload.hasKnowledge ?? Boolean(payload.knowledgeFiles?.length);
    const knowledgeOnly = payload.knowledgeOnly ?? Boolean(payload.knowledgeFiles?.length);
    const internetEnabled = payload.internetEnabled ?? true;
    const mcpEnabled = payload.mcpEnabled ?? false;
    const mcpUrl = payload.mcpUrl?.trim();
    const mcpSecret = payload.mcpSecret?.trim();
    const childAgentIds = [...new Set(payload.childAgentIds ?? [])];

    if (mcpEnabled && (!mcpUrl || !mcpSecret)) {
      throw new HttpError(400, "mcpUrl and mcpSecret are required when mcpEnabled is true");
    }

    if (!mcpEnabled && (mcpUrl || mcpSecret)) {
      throw new HttpError(400, "Set mcpEnabled=true to configure mcpUrl and mcpSecret");
    }

    if (childAgentIds.length && !enableChildOrchestration) {
      throw new HttpError(400, "Child agent orchestration is disabled");
    }

    const existingChildIds = await listExistingAgentIds(childAgentIds);
    if (existingChildIds.length !== childAgentIds.length) {
      throw new HttpError(400, "One or more childAgentIds are invalid");
    }

    const agent = await createAgentRecord({
      id: `agent-${Date.now()}`,
      name: payload.name,
      description: payload.description,
      goal: payload.goal,
      systemPrompt: payload.systemPrompt,
      outputMode,
      hasKnowledge,
      knowledgeOnly,
      internetEnabled,
      mcpEnabled,
      mcpUrl: mcpEnabled ? mcpUrl ?? null : null,
      mcpSecret: mcpEnabled ? mcpSecret ?? null : null,
    });

    let knowledgeUpload = { fileCount: 0, chunkCount: 0 };

    if (payload.knowledgeFiles?.length) {
      const persisted = await persistKnowledgeFiles(agent.id, payload.knowledgeFiles);
      knowledgeUpload = {
        fileCount: payload.knowledgeFiles.length,
        chunkCount: persisted.createdChunks.length,
      };
    }

    if (childAgentIds.includes(agent.id)) {
      throw new HttpError(400, "Parent agent cannot include itself as child");
    }

    await attachChildAgentsToParent(agent.id, childAgentIds);

    const hydratedAgent = await getAgentById(agent.id);

    res.status(201).json({ agent: hydratedAgent, knowledgeUpload });
  })
);

app.post(
  "/chat",
  asyncHandler(async (req, res) => {
    const payload = validateBody(chatSchema, req.body);
    const agentRecord = await getAgentRecordById(payload.agentId);
    const agent = await enrichAgent(agentRecord);

    const useKnowledge = agent.knowledgeOnly ? true : payload.useKnowledge ?? agent.hasKnowledge;
    const topK = payload.topK ?? ragTopKDefault;
    const userMessage = payload.message;
    const orchestrated = await orchestrateParentTurn({
      parentAgentRecord: agentRecord,
      userMessage,
      useKnowledge,
      topK,
    });

    const response = orchestrated.response;

    const traceId = await recordTrace(
      "chat_call",
      {
        agentId: agent.id,
        message: userMessage,
        useKnowledge,
        topK,
        mcpEnabled: agent.mcpEnabled,
      },
      {
        provider: orchestrated.provider,
        retrievedChunkCount: orchestrated.retrievedChunks.length,
        mcpAttempted: orchestrated.mcpInvocation.attempted,
        mcpSuccess: orchestrated.mcpInvocation.success,
        delegation: orchestrated.delegation,
      },
      undefined,
      {
        agentId: agent.id,
        agentName: agent.name,
        isParent: orchestrated.delegation.attempted,
        selectedChildAgentId: orchestrated.delegation.selectedChildAgentId,
        selectedChildAgentName: orchestrated.delegation.selectedChildAgentName,
        childInvocationSuccess: orchestrated.delegation.success,
        childInvocationMs: orchestrated.delegation.latencyMs,
      },
      [`agent:${agent.id}`]
    );

    if (traceId && normalizeChatResponseText(response).trim().length >= 12) {
      enqueueJudgeJob({
        traceId,
        agentId: agent.id,
        agentName: agent.name,
        userMessage,
        responseText: normalizeChatResponseText(response),
        retrievedChunkCount: orchestrated.retrievedChunks.length,
        createdAt: new Date().toISOString(),
      });
    }

    res.json({
      agentId: agent.id,
      outputMode: agent.outputMode,
      internetEnabled: agent.internetEnabled,
      knowledgeOnly: agent.knowledgeOnly,
      useKnowledge,
      retrievedChunkCount: orchestrated.retrievedChunks.length,
      retrievedChunks: orchestrated.retrievedChunks,
      mcpInvocation: orchestrated.mcpInvocation,
      delegation: orchestrated.delegation,
      provider: orchestrated.provider,
      traceId,
      response,
    });
  })
);

app.post(
  "/chat/feedback",
  asyncHandler(async (req, res) => {
    const payload = validateBody(feedbackSchema, req.body);
    const agent = await getAgentById(payload.agentId);

    const saved = await recordScore({
      traceId: payload.traceId,
      agentId: agent.id,
      agentName: agent.name,
      score: payload.score,
      comment: payload.comment,
    });

    if (!saved) {
      throw new HttpError(503, "Unable to submit feedback score");
    }

    res.json({ ok: true });
  })
);

app.get(
  "/metrics/agents/feedback",
  asyncHandler(async (req, res) => {
    const query = validateQuery(feedbackMetricsQuerySchema, req.query);
    const fromDate = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000).toISOString();
    const agents = await listAgentsRecords();
    const feedbackScores = await listAgentScores({
      fromTimestamp: fromDate,
      scoreName: "user_feedback",
      dataType: "BOOLEAN",
    });
    const judgeScores = await listAgentScores({
      fromTimestamp: fromDate,
      scoreName: "judge_quality",
      dataType: "NUMERIC",
    });

    const countsByAgent = new Map<string, { votes: number; positiveVotes: number }>();
    for (const score of feedbackScores) {
      const current = countsByAgent.get(score.agentId) ?? { votes: 0, positiveVotes: 0 };
      current.votes += 1;
      if (score.value === 1) {
        current.positiveVotes += 1;
      }
      countsByAgent.set(score.agentId, current);
    }

    const judgeByAgent = new Map<string, { count: number; sum: number }>();
    for (const score of judgeScores) {
      const current = judgeByAgent.get(score.agentId) ?? { count: 0, sum: 0 };
      current.count += 1;
      current.sum += score.value;
      judgeByAgent.set(score.agentId, current);
    }

    const rows = agents.map((agent) => {
      const stats = countsByAgent.get(agent.id) ?? { votes: 0, positiveVotes: 0 };
      const judge = judgeByAgent.get(agent.id) ?? { count: 0, sum: 0 };
      const votes = stats.votes;
      const positiveVotes = stats.positiveVotes;
      const negativeVotes = votes - positiveVotes;

      return {
        agentId: agent.id,
        agentName: agent.name,
        votes,
        positiveVotes,
        negativeVotes,
        positiveRate: votes ? Number((positiveVotes / votes).toFixed(3)) : null,
        judgeCount: judge.count,
        judgeAvg: judge.count ? Number((judge.sum / judge.count).toFixed(3)) : null,
      };
    });

    rows.sort((a, b) => {
      const aScore = a.positiveRate ?? -1;
      const bScore = b.positiveRate ?? -1;
      if (bScore !== aScore) {
        return bScore - aScore;
      }
      return b.votes - a.votes;
    });

    res.json({
      windowDays: query.days,
      fromTimestamp: fromDate,
      metrics: rows,
    });
  })
);

app.post(
  "/skills/agent-creator",
  asyncHandler(async (req, res) => {
    const payload = validateBody(skillSchema, req.body);
    const outputMode = payload.outputMode ?? "text";

    const result = createAgentSkillOutput({
      name: payload.name,
      description: payload.description,
      goal: payload.goal,
      outputMode,
    });

    const traceId = await recordTrace(
      "agent_creator_skill",
      {
        name: payload.name,
        goal: payload.goal,
        outputMode,
      },
      {
        systemPromptLength: result.systemPrompt.length,
        constraints: result.constraints.length,
        examplePrompts: result.examplePrompts.length,
        evaluationCases: result.evaluationCases.length,
      }
    );

    res.json({
      outputMode,
      traceId,
      result,
    });
  })
);

app.patch(
  "/agents/:id/knowledge",
  asyncHandler(async (req, res) => {
    const payload = validateBody(knowledgeToggleSchema, req.body);
    const agent = await updateAgentKnowledge(String(req.params.id), payload.hasKnowledge);

    if (!agent) {
      throw new HttpError(404, "Agent not found");
    }

    res.json({
      agentId: agent.id,
      hasKnowledge: agent.hasKnowledge,
    });
  })
);

app.post(
  "/files/upload",
  asyncHandler(async (req, res) => {
    const payload = validateBody(uploadSchema, req.body);
    const agent = await getAgentById(payload.agentId);

    const persisted = await persistKnowledgeFiles(agent.id, [
      {
        fileName: payload.fileName,
        content: payload.content,
        contentEncoding: payload.contentEncoding,
        mimeType: payload.mimeType,
      },
    ]);
    await updateAgentKnowledge(agent.id, true);

    res.status(201).json({
      fileName: payload.fileName,
      storedAt: persisted.storedFiles[0],
      chunkCount: persisted.createdChunks.length,
      chunks: persisted.createdChunks,
    });
  })
);

app.get(
  "/agents/:id/chunks",
  asyncHandler(async (req, res) => {
    const agent = await getAgentById(String(req.params.id));
    const query = validateQuery(chunksQuerySchema, req.query);
    const q = query.q;
    const topK = query.k;

    const results = await retrieveTopChunks(agent.id, q, topK);

    res.json({
      agentId: agent.id,
      query: q,
      topK,
      count: results.length,
      chunks: results,
    });
  })
);

app.use((req, _res, next) => {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      error: error.message,
      details: error.details,
    });
    return;
  }

  console.error("Unhandled API error", error);

  res.status(500).json({
    error: "Internal server error",
    details: process.env.NODE_ENV === "production" ? undefined : String((error as Error)?.message ?? error),
  });
});

const port = Number(process.env.PORT ?? 3001);

async function startServer(): Promise<void> {
  await initDatabase();

  console.log(
    `Embeddings: provider=${embeddingConfig.provider} model=${embeddingConfig.model} dim=${embeddingConfig.dimensions} fallback=${embeddingConfig.usingFallback}`
  );

  app.listen(port, () => {
    console.log(`API running on http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start API", error);
  process.exit(1);
});
