import OpenAI from "openai";

/**
 * OpenAI embeddings wrapper. text-embedding-3-large with dims=1536 so
 * vectors slot into the rgaios_agent_file_chunks.embedding vector(1536)
 * column. Batches up to 96 inputs per call to stay well under the 2048
 * input cap on the v1 embeddings endpoint.
 *
 * Fails loud if OPENAI_API_KEY is missing — chunks with null embedding
 * still get stored so the upload does not silently lose data, but
 * knowledge_query will skip them until a backfill runs.
 */

const MODEL = "text-embedding-3-large";
const DIMENSIONS = 1536;
const BATCH = 96;

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  _client = new OpenAI({ apiKey });
  return _client;
}

export async function embedBatch(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const all: number[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH) {
    const slice = inputs.slice(i, i + BATCH);
    const res = await client().embeddings.create({
      model: MODEL,
      dimensions: DIMENSIONS,
      input: slice,
    });
    for (const item of res.data) all.push(item.embedding as number[]);
  }
  return all;
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embedBatch([text]);
  return v;
}

/**
 * Postgres pgvector literal format: '[0.1,0.2,...]'. Supabase-js passes
 * strings through untouched for vector columns, so this is the shape
 * inserts/updates expect.
 */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
