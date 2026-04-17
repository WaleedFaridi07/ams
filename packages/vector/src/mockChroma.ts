export type VectorRecord = {
  id: string;
  agentId: string;
  text: string;
  embedding: number[];
};

export type SearchMatch = {
  id: string;
  score: number;
  text: string;
};

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export class MockChromaClient {
  private readonly records: VectorRecord[] = [];

  upsert(record: VectorRecord): void {
    this.records.push(record);
  }

  search(agentId: string, queryEmbedding: number[], topK = 3): SearchMatch[] {
    return this.records
      .filter((record) => record.agentId === agentId)
      .map((record) => ({
        id: record.id,
        text: record.text,
        score: Number(cosineSimilarity(record.embedding, queryEmbedding).toFixed(6)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
