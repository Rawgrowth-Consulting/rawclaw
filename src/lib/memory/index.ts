/**
 * Memory layer for v4. Pluggable adapters:
 *
 *   - HermesLocal     in-process via Hermes's own SQLite state.db
 *                     (default; lowest latency; loses if VPS dies)
 *   - Honcho          self-hosted REST service against Supabase pgvector
 *                     (durable + rich user_models + summaries; adds
 *                     ~50ms per turn; one docker service per VPS)
 *   - Mem0            cloud (or self-hosted) semantic memory service
 *                     with episodic + procedural tiers and chunked
 *                     retrieval; pluggable as a tier alongside Honcho
 *
 * Strategy: chain them. Every turn the bridge writes to the active
 * tiers in parallel, reads back the merged context on the next prompt
 * build. Tiers are configured per-VPS via env.
 *
 *   MEMORY_TIERS="hermes,honcho,mem0"
 *   HONCHO_BASE_URL="http://honcho:8000"
 *   MEM0_API_KEY="m0-..."
 *
 * Disabled tiers skip cleanly; if none enabled, only Hermes local
 * SQLite is used (the v3 baseline behavior).
 */

export interface MemoryWrite {
  organizationId: string;
  agentId: string;
  userId?: string | null;
  session: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryRead {
  organizationId: string;
  agentId: string;
  userId?: string | null;
  session: string;
  /** Free-text query to retrieve relevant memory snippets for. */
  query: string;
  /** Max snippets per tier. */
  limit?: number;
}

export interface MemorySnippet {
  source: "hermes" | "honcho" | "mem0";
  content: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryAdapter {
  name: "hermes" | "honcho" | "mem0";
  /** Write a turn to this tier. Best-effort, errors logged but not thrown. */
  write(turn: MemoryWrite): Promise<void>;
  /** Retrieve relevant snippets for the next prompt build. */
  read(req: MemoryRead): Promise<MemorySnippet[]>;
}

/* -------------------------------------------------------------------- */
/* Hermes local SQLite tier (default, no extra infra)                    */
/* -------------------------------------------------------------------- */

/**
 * Hermes already stores conversation state in /root/.hermes/state.db
 * per session. This adapter is a no-op writer (Hermes writes on its
 * own when /api/ws receives a turn) and a thin reader via the
 * /api/sessions/{id}/messages REST endpoint. Kept here so the tier
 * chain has a unified shape.
 */
export class HermesLocalAdapter implements MemoryAdapter {
  name = "hermes" as const;
  async write(_turn: MemoryWrite): Promise<void> {
    // Hermes writes its own state.db when /api/ws ingests the turn.
    return;
  }
  async read(req: MemoryRead): Promise<MemorySnippet[]> {
    // Pull last N messages from this session as snippets. The Hermes
    // session id is built deterministically as `org:<orgId>:chat:<chatId>`
    // by the bridge, so we can read it back here.
    const { hermesSessions } = await import("@/lib/hermes/client");
    try {
      const messages = await hermesSessions.messages(req.session);
      return messages.slice(-(req.limit ?? 10)).map((m) => ({
        source: "hermes" as const,
        content: m.content,
        metadata: { role: m.role, created_at: m.created_at },
      }));
    } catch (err) {
      console.warn("[memory:hermes] read failed:", err);
      return [];
    }
  }
}

/* -------------------------------------------------------------------- */
/* Honcho self-hosted tier                                               */
/* -------------------------------------------------------------------- */

/**
 * Honcho is a memory service from Plastic Labs. Self-hosted version
 * runs as a docker service against the same Supabase Postgres (pgvector
 * required). On v3 we wired this once, dropped it for the v4 sprint
 * because the chat surface SQLite was enough. We re-add it here as an
 * optional tier; enable by setting `MEMORY_TIERS` to include "honcho"
 * + `HONCHO_BASE_URL`.
 *
 * Honcho REST shape (v0.0.x):
 *   POST /apps/<app>/users/<user>/sessions/<session>/messages
 *   GET  /apps/<app>/users/<user>/sessions/<session>/messages
 *   GET  /apps/<app>/users/<user>/facts?query=<q>
 *
 * App = organization. User = client end-user. Session = chat thread.
 */
export class HonchoAdapter implements MemoryAdapter {
  name = "honcho" as const;
  private baseUrl: string;
  private appHeader: string;
  constructor() {
    this.baseUrl =
      process.env.HONCHO_BASE_URL?.trim() || "http://localhost:8000";
    this.appHeader = process.env.HONCHO_APP_NAME?.trim() || "rawclaw";
  }
  async write(turn: MemoryWrite): Promise<void> {
    const user = turn.userId || `agent:${turn.agentId}`;
    const url = `${this.baseUrl}/apps/${encodeURIComponent(
      `${this.appHeader}:${turn.organizationId}`,
    )}/users/${encodeURIComponent(user)}/sessions/${encodeURIComponent(
      turn.session,
    )}/messages`;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: turn.content,
          is_user: turn.role === "user",
          metadata: { role: turn.role, ...turn.metadata },
        }),
      });
    } catch (err) {
      console.warn("[memory:honcho] write failed:", err);
    }
  }
  async read(req: MemoryRead): Promise<MemorySnippet[]> {
    const user = req.userId || `agent:${req.agentId}`;
    const url = `${this.baseUrl}/apps/${encodeURIComponent(
      `${this.appHeader}:${req.organizationId}`,
    )}/users/${encodeURIComponent(user)}/facts?query=${encodeURIComponent(
      req.query,
    )}&limit=${req.limit ?? 5}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = (await res.json()) as {
        facts?: Array<{ content: string; score?: number }>;
      };
      return (data.facts ?? []).map((f) => ({
        source: "honcho" as const,
        content: f.content,
        score: f.score,
      }));
    } catch (err) {
      console.warn("[memory:honcho] read failed:", err);
      return [];
    }
  }
}

/* -------------------------------------------------------------------- */
/* Mem0 cloud/self-hosted tier                                           */
/* -------------------------------------------------------------------- */

/**
 * mem0 (mem0.ai) is a semantic memory service with episodic +
 * procedural tiers. SaaS by default; self-hosted possible via
 * https://github.com/mem0ai/mem0.
 *
 * Enable by including "mem0" in MEMORY_TIERS + MEM0_API_KEY.
 * Optional MEM0_BASE_URL if self-hosting.
 */
export class Mem0Adapter implements MemoryAdapter {
  name = "mem0" as const;
  private baseUrl: string;
  private apiKey: string;
  constructor() {
    this.baseUrl =
      process.env.MEM0_BASE_URL?.trim() || "https://api.mem0.ai/v1";
    this.apiKey = process.env.MEM0_API_KEY?.trim() || "";
  }
  private headers(extra: Record<string, string> = {}): HeadersInit {
    return {
      Authorization: `Token ${this.apiKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }
  async write(turn: MemoryWrite): Promise<void> {
    if (!this.apiKey) return;
    try {
      await fetch(`${this.baseUrl}/memories`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          messages: [{ role: turn.role, content: turn.content }],
          user_id: turn.userId || `agent:${turn.agentId}`,
          agent_id: turn.agentId,
          metadata: {
            organization_id: turn.organizationId,
            session: turn.session,
            ...turn.metadata,
          },
        }),
      });
    } catch (err) {
      console.warn("[memory:mem0] write failed:", err);
    }
  }
  async read(req: MemoryRead): Promise<MemorySnippet[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch(
        `${this.baseUrl}/memories/search?query=${encodeURIComponent(
          req.query,
        )}&user_id=${encodeURIComponent(req.userId || `agent:${req.agentId}`)}&limit=${req.limit ?? 5}`,
        { headers: this.headers() },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as {
        results?: Array<{ memory: string; score?: number }>;
      };
      return (data.results ?? []).map((r) => ({
        source: "mem0" as const,
        content: r.memory,
        score: r.score,
      }));
    } catch (err) {
      console.warn("[memory:mem0] read failed:", err);
      return [];
    }
  }
}

/* -------------------------------------------------------------------- */
/* Tier chain orchestrator                                               */
/* -------------------------------------------------------------------- */

let cachedChain: MemoryAdapter[] | null = null;

export function getMemoryTiers(): MemoryAdapter[] {
  if (cachedChain) return cachedChain;
  const raw = (process.env.MEMORY_TIERS || "hermes")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const chain: MemoryAdapter[] = [];
  for (const t of raw) {
    if (t === "hermes") chain.push(new HermesLocalAdapter());
    else if (t === "honcho") chain.push(new HonchoAdapter());
    else if (t === "mem0") chain.push(new Mem0Adapter());
  }
  cachedChain = chain;
  return chain;
}

/** Fan-out write to every enabled tier in parallel. */
export async function writeMemory(turn: MemoryWrite): Promise<void> {
  const chain = getMemoryTiers();
  await Promise.allSettled(chain.map((a) => a.write(turn)));
}

/** Fan-out read across every enabled tier, then concatenate snippets. */
export async function readMemory(
  req: MemoryRead,
): Promise<MemorySnippet[]> {
  const chain = getMemoryTiers();
  const results = await Promise.allSettled(chain.map((a) => a.read(req)));
  const out: MemorySnippet[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push(...r.value);
  }
  return out;
}
