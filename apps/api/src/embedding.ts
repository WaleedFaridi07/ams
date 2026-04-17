import { OpenAIEmbeddings } from "@langchain/openai";

const targetDimension = Number(process.env.EMBEDDING_DIM ?? 6);
const embeddingModel = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const embeddingProvider = (process.env.EMBEDDING_PROVIDER ?? "openai").toLowerCase();

let cachedOpenAiEmbeddings: OpenAIEmbeddings | null = null;

function normalize(values: number[]): number[] {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return values;
  }
  return values.map((value) => Number((value / magnitude).toFixed(6)));
}

function hashEmbedding(text: string): number[] {
  const vector = Array.from({ length: Math.max(1, targetDimension) }, () => 0);

  for (let index = 0; index < text.length; index += 1) {
    const charCode = text.charCodeAt(index);
    vector[index % vector.length] += charCode;
  }

  return normalize(vector);
}

function compressEmbedding(values: number[]): number[] {
  const dim = Math.max(1, targetDimension);
  if (!values.length) {
    return Array.from({ length: dim }, () => 0);
  }

  if (values.length <= dim) {
    const output = Array.from({ length: dim }, (_, index) => values[index] ?? 0);
    return normalize(output);
  }

  const bucketSize = values.length / dim;
  const output: number[] = [];

  for (let bucket = 0; bucket < dim; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * bucketSize));
    let total = 0;
    let count = 0;

    for (let index = start; index < end && index < values.length; index += 1) {
      total += values[index];
      count += 1;
    }

    output.push(count ? total / count : 0);
  }

  return normalize(output);
}

function getOpenAiEmbeddings(): OpenAIEmbeddings {
  if (!cachedOpenAiEmbeddings) {
    cachedOpenAiEmbeddings = new OpenAIEmbeddings({
      model: embeddingModel,
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return cachedOpenAiEmbeddings;
}

function canUseOpenAiEmbeddings(): boolean {
  return embeddingProvider === "openai" && Boolean(process.env.OPENAI_API_KEY);
}

export async function embedText(text: string): Promise<number[]> {
  if (!canUseOpenAiEmbeddings()) {
    return hashEmbedding(text);
  }

  const model = getOpenAiEmbeddings();
  const values = await model.embedQuery(text);
  return compressEmbedding(values);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!texts.length) {
    return [];
  }

  if (!canUseOpenAiEmbeddings()) {
    return texts.map(hashEmbedding);
  }

  const model = getOpenAiEmbeddings();
  const vectors = await model.embedDocuments(texts);
  return vectors.map(compressEmbedding);
}

export function getEmbeddingConfigSummary(): {
  provider: string;
  model: string;
  dimensions: number;
  usingFallback: boolean;
} {
  return {
    provider: embeddingProvider,
    model: embeddingModel,
    dimensions: targetDimension,
    usingFallback: !canUseOpenAiEmbeddings(),
  };
}
