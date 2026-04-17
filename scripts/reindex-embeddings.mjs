import dotenv from "dotenv";
import { Pool } from "pg";
import { OpenAIEmbeddings } from "@langchain/openai";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
const openAiApiKey = process.env.OPENAI_API_KEY;
const embeddingModel = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const targetDimension = Number(process.env.EMBEDDING_DIM ?? 6);
const batchSize = Math.max(1, Number(process.env.REINDEX_BATCH_SIZE ?? 40));

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

if (!openAiApiKey) {
  throw new Error("OPENAI_API_KEY is required for reindexing real embeddings");
}

function normalize(values) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return values;
  }
  return values.map((value) => Number((value / magnitude).toFixed(6)));
}

function compressEmbedding(values) {
  const dim = Math.max(1, targetDimension);
  if (!values.length) {
    return Array.from({ length: dim }, () => 0);
  }

  if (values.length <= dim) {
    return normalize(Array.from({ length: dim }, (_, index) => values[index] ?? 0));
  }

  const bucketSize = values.length / dim;
  const output = [];

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

function toVectorLiteral(values) {
  return `[${values.map((value) => Number(value.toFixed(6))).join(",")}]`;
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });
  const embeddings = new OpenAIEmbeddings({
    model: embeddingModel,
    apiKey: openAiApiKey,
  });

  const rowsResult = await pool.query("SELECT id, text FROM chunks ORDER BY created_at ASC");
  const rows = rowsResult.rows;
  console.log(`Reindexing ${rows.length} chunks with model ${embeddingModel} (dim=${targetDimension})`);

  let updated = 0;

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const texts = batch.map((row) => String(row.text ?? ""));
    const vectors = await embeddings.embedDocuments(texts);

    for (let index = 0; index < batch.length; index += 1) {
      const row = batch[index];
      const compressed = compressEmbedding(vectors[index] ?? []);
      await pool.query("UPDATE chunks SET embedding = $2::vector WHERE id = $1", [
        String(row.id),
        toVectorLiteral(compressed),
      ]);
      updated += 1;
    }

    console.log(`Processed ${updated}/${rows.length}`);
  }

  await pool.end();
  console.log("Reindex complete");
}

main().catch((error) => {
  console.error("Reindex failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
