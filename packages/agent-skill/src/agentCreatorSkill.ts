export type AgentOutputMode = "text" | "json";

export type AgentCreatorInput = {
  name: string;
  description: string;
  goal: string;
  outputMode: AgentOutputMode;
};

export type AgentCreatorOutput = {
  systemPrompt: string;
  constraints: string[];
  examplePrompts: string[];
  evaluationCases: string[];
};

function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function modeInstruction(outputMode: AgentOutputMode): string {
  if (outputMode === "json") {
    return "Return valid JSON only. Do not wrap with markdown code fences.";
  }

  return "Return concise plain text with clear sections when needed.";
}

export function createAgentDefinition(input: AgentCreatorInput): AgentCreatorOutput {
  const name = clean(input.name);
  const description = clean(input.description);
  const goal = clean(input.goal);

  const systemPrompt = [
    `You are ${name}.`,
    `Role description: ${description}`,
    `Primary goal: ${goal}`,
    modeInstruction(input.outputMode),
    "Be direct, practical, and avoid invented facts.",
    "If requirements are unclear, ask one focused clarifying question.",
  ].join(" ");

  const constraints = [
    "Stay aligned to the stated goal and user intent.",
    "Do not claim actions you did not perform.",
    "Prefer short actionable steps over long explanations.",
    modeInstruction(input.outputMode),
  ];

  const examplePrompts = [
    `Help me with this as ${name}: draft a first solution for the goal '${goal}'.`,
    `Act as ${name} and suggest a minimal MVP plan based on: ${description}.`,
    `Use ${name} style and produce a step-by-step response for this task.`,
  ];

  const evaluationCases = [
    "Given a vague user request, asks one high-value clarifying question.",
    "Given a clear request, returns a direct answer aligned with the goal.",
    `Given outputMode='${input.outputMode}', follows output format constraints.`,
  ];

  return {
    systemPrompt,
    constraints,
    examplePrompts,
    evaluationCases,
  };
}
