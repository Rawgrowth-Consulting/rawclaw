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
  source: "hermes" | "honcho" | "mem0" | "letta";
  content: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface MemoryAdapter {
  name: "hermes" | "honcho" | "mem0" | "letta";
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
 * Honcho is a memory service from Plastic Labs. Self-hosted via the
 * `ghcr.io/plastic-labs/honcho:latest` docker image + bundled
 * postgres (pgvector) + redis (confirmed running on Admin VPS at
 * http://127.0.0.1:8001 with a healthy 4-container compose stack).
 *
 * Honcho v3 IDs only accept `^[a-zA-Z0-9_-]+$`, so we map separators
 * as underscores rather than colons:
 *
 *   workspace_id = `rgaios_${orgId.replace(/-/g, '')}`
 *   peer_id      = (userId || `agent_${agentId}`).replace(/[^a-zA-Z0-9_-]/g, '_')
 *   session_id   = turn.session.replace(/[^a-zA-Z0-9_-]/g, '_')
 *
 * Write path (confirmed live):
 *   POST /v3/workspaces                                  upsert workspace
 *   POST /v3/workspaces/{ws}/peers                        upsert peer
 *   POST /v3/workspaces/{ws}/peers/{peer}/sessions        upsert session
 *   POST /v3/workspaces/{ws}/sessions/{session}/messages  write message
 *
 * Read path:
 *   POST /v3/workspaces/{ws}/peers/{peer}/search          semantic recall
 *   POST /v3/workspaces/{ws}/peers/{peer}/chat            dialectic query
 *
 * Enable by setting `MEMORY_TIERS=hermes,honcho` + `HONCHO_BASE_URL`.
 */
export class HonchoAdapter implements MemoryAdapter {
  name = "honcho" as const;
  private baseUrl: string;
  private apiKey: string;
  private ensured = new Set<string>();
  constructor() {
    this.baseUrl =
      process.env.HONCHO_BASE_URL?.trim() || "http://localhost:8001";
    this.apiKey = process.env.HONCHO_API_KEY?.trim() || "";
  }
  private headers(extra: Record<string, string> = {}): HeadersInit {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...extra,
    };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }
  private sanitize(s: string): string {
    return s.replace(/[^a-zA-Z0-9_-]/g, "_");
  }
  private wsId(turn: { organizationId: string }): string {
    return `rgaios_${this.sanitize(turn.organizationId)}`;
  }
  private peerId(turn: { agentId: string; userId?: string | null }): string {
    const raw = turn.userId || `agent_${turn.agentId}`;
    return this.sanitize(raw);
  }
  private sessionId(turn: { session: string }): string {
    return this.sanitize(turn.session);
  }

  /** Ensure workspace + peer + session exist (best-effort, idempotent).
   *  Cached per (ws, peer, session) so we only call create-once per process. */
  private async ensureChain(
    ws: string,
    peer: string,
    session: string,
  ): Promise<void> {
    const key = `${ws}|${peer}|${session}`;
    if (this.ensured.has(key)) return;
    const post = (path: string, body: unknown) =>
      fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      }).catch(() => null);
    await post(`/v3/workspaces`, { id: ws });
    await post(`/v3/workspaces/${ws}/peers`, { id: peer });
    await post(`/v3/workspaces/${ws}/peers/${peer}/sessions`, {
      id: session,
    });
    this.ensured.add(key);
  }

  async write(turn: MemoryWrite): Promise<void> {
    const ws = this.wsId(turn);
    const peer = this.peerId(turn);
    const session = this.sessionId(turn);
    try {
      await this.ensureChain(ws, peer, session);
      const url = `${this.baseUrl}/v3/workspaces/${ws}/sessions/${session}/messages`;
      await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          messages: [
            {
              peer_id: peer,
              content: turn.content,
              metadata: { role: turn.role, ...turn.metadata },
            },
          ],
        }),
      });
    } catch (err) {
      console.warn("[memory:honcho] write failed:", err);
    }
  }
  async read(req: MemoryRead): Promise<MemorySnippet[]> {
    const ws = this.wsId(req);
    const peer = this.peerId(req);
    const url = `${this.baseUrl}/v3/workspaces/${ws}/peers/${peer}/search`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          query: req.query,
          limit: req.limit ?? 5,
        }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        results?: Array<{ content: string; score?: number }>;
        items?: Array<{ content: string; score?: number }>;
      };
      const list = data.results ?? data.items ?? [];
      return list.map((f) => ({
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
 * mem0 (openmemory self-hosted at github.com/mem0ai/mem0/openmemory).
 *
 * Deployed via `docker compose up -d --build` in the cloned mem0 repo
 * at openmemory/. Stack: qdrant vector store (:6333) + openmemory-mcp
 * API (:8765, uvicorn FastAPI) + openmemory-ui (:3000, Next.js).
 *
 * v1 REST shape (probed live via /openapi.json):
 *   POST /api/v1/memories/                                write memory
 *   GET  /api/v1/memories/?user_id=&query=                list/search
 *   POST /api/v1/memories/filter                          search by filter
 *   GET  /api/v1/memories/{memory_id}                     get one
 *   GET  /api/v1/memories/{memory_id}/related             related
 *
 * IMPORTANT: openmemory needs an embedder (default OpenAI
 * text-embedding-3-small). Either set OPENAI_API_KEY on the
 * openmemory api container, or override the embedder via
 * EMBEDDER_PROVIDER=ollama + EMBEDDER_MODEL=nomic-embed-text +
 * Ollama at OLLAMA_BASE_URL. Without a working embedder, write calls
 * return 401 from the upstream LLM provider.
 *
 * Cloud SaaS endpoint at https://api.mem0.ai/v1 also works; set
 * MEM0_BASE_URL + MEM0_API_KEY env to use the cloud version.
 */
export class Mem0Adapter implements MemoryAdapter {
  name = "mem0" as const;
  private baseUrl: string;
  private apiKey: string;
  private isSelfHosted: boolean;
  constructor() {
    this.baseUrl =
      process.env.MEM0_BASE_URL?.trim() || "http://localhost:8765";
    this.apiKey = process.env.MEM0_API_KEY?.trim() || "";
    // Heuristic: localhost / 127.0.0.1 / no api key implies self-hosted
    this.isSelfHosted =
      /localhost|127\.0\.0\.1|::1/.test(this.baseUrl) || !this.apiKey;
  }
  private headers(extra: Record<string, string> = {}): HeadersInit {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...extra,
    };
    if (!this.isSelfHosted && this.apiKey) {
      h.Authorization = `Token ${this.apiKey}`;
    }
    return h;
  }
  private writePath(): string {
    return this.isSelfHosted
      ? `${this.baseUrl}/api/v1/memories/`
      : `${this.baseUrl}/memories`;
  }
  private readPath(query: string, userId: string, limit: number): string {
    return this.isSelfHosted
      ? `${this.baseUrl}/api/v1/memories/?user_id=${encodeURIComponent(
          userId,
        )}&search_query=${encodeURIComponent(query)}&size=${limit}`
      : `${this.baseUrl}/memories/search?query=${encodeURIComponent(
          query,
        )}&user_id=${encodeURIComponent(userId)}&limit=${limit}`;
  }
  async write(turn: MemoryWrite): Promise<void> {
    const userId = turn.userId || `agent_${turn.agentId}`;
    const body = this.isSelfHosted
      ? {
          user_id: userId,
          text: turn.content,
          app: "rawclaw",
          metadata: {
            role: turn.role,
            organization_id: turn.organizationId,
            session: turn.session,
            ...turn.metadata,
          },
        }
      : {
          messages: [{ role: turn.role, content: turn.content }],
          user_id: userId,
          agent_id: turn.agentId,
          metadata: {
            organization_id: turn.organizationId,
            session: turn.session,
            ...turn.metadata,
          },
        };
    try {
      await fetch(this.writePath(), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.warn("[memory:mem0] write failed:", err);
    }
  }
  async read(req: MemoryRead): Promise<MemorySnippet[]> {
    const userId = req.userId || `agent_${req.agentId}`;
    try {
      const res = await fetch(this.readPath(req.query, userId, req.limit ?? 5), {
        headers: this.headers(),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        items?: Array<{ content?: string; memory?: string; score?: number }>;
        results?: Array<{ memory?: string; content?: string; score?: number }>;
      };
      const list = data.items ?? data.results ?? [];
      return list.map((r) => ({
        source: "mem0" as const,
        content: r.content ?? r.memory ?? "",
        score: r.score,
      }));
    } catch (err) {
      console.warn("[memory:mem0] read failed:", err);
      return [];
    }
  }
}

/* -------------------------------------------------------------------- */
/* Letta (formerly MemGPT) tier                                          */
/* -------------------------------------------------------------------- */

/**
 * Letta is the open-source rebrand of MemGPT with self-hosted REST. Run
 * via `docker run -it -p 8283:8283 letta/letta:latest` or compose. It
 * provides hierarchical memory (core/recall/archival) with automatic
 * memory editing by the agent itself.
 *
 * Enable by including "letta" in MEMORY_TIERS + LETTA_BASE_URL (default
 * http://localhost:8283). LETTA_PASSWORD optional.
 *
 * v1 REST shape:
 *   POST /v1/agents                                       create agent
 *   POST /v1/agents/{agent_id}/messages                   send message
 *   POST /v1/agents/{agent_id}/archival                   write archival mem
 *   GET  /v1/agents/{agent_id}/archival?query=            search archival
 */
export class LettaAdapter implements MemoryAdapter {
  name = "letta" as const;
  private baseUrl: string;
  private password: string;
  private agentCache = new Map<string, string>();
  constructor() {
    this.baseUrl =
      process.env.LETTA_BASE_URL?.trim() || "http://localhost:8283";
    this.password = process.env.LETTA_PASSWORD?.trim() || "";
  }
  private headers(extra: Record<string, string> = {}): HeadersInit {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...extra,
    };
    if (this.password) h.Authorization = `Bearer ${this.password}`;
    return h;
  }
  /** Map (org, agent, user) to a stable Letta agent_id; lazily create. */
  private async ensureAgent(turn: {
    organizationId: string;
    agentId: string;
    userId?: string | null;
  }): Promise<string> {
    const key = `${turn.organizationId}|${turn.agentId}|${
      turn.userId ?? "_"
    }`;
    const cached = this.agentCache.get(key);
    if (cached) return cached;
    const name = `rgaios_${turn.organizationId}_${turn.agentId}_${
      turn.userId ?? "default"
    }`.replace(/[^a-zA-Z0-9_-]/g, "_");
    try {
      const res = await fetch(`${this.baseUrl}/v1/agents`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = (await res.json()) as { id?: string };
        if (data.id) {
          this.agentCache.set(key, data.id);
          return data.id;
        }
      }
    } catch {
      /* ignore */
    }
    return name; // Some Letta versions accept name in place of id
  }
  async write(turn: MemoryWrite): Promise<void> {
    try {
      const agentId = await this.ensureAgent(turn);
      await fetch(
        `${this.baseUrl}/v1/agents/${encodeURIComponent(agentId)}/archival-memory`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ text: turn.content }),
        },
      );
    } catch (err) {
      console.warn("[memory:letta] write failed:", err);
    }
  }
  async read(req: MemoryRead): Promise<MemorySnippet[]> {
    try {
      const agentId = await this.ensureAgent(req);
      const url = `${this.baseUrl}/v1/agents/${encodeURIComponent(
        agentId,
      )}/archival-memory/search`;
      const res = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ query: req.query, limit: req.limit ?? 5 }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as
        | Array<{ text?: string; content?: string; score?: number }>
        | { passages?: Array<{ text?: string; content?: string; score?: number }> };
      const list = Array.isArray(data) ? data : data.passages ?? [];
      return list.map((r) => ({
        source: "letta" as const,
        content: r.text ?? r.content ?? "",
        score: r.score,
      }));
    } catch (err) {
      console.warn("[memory:letta] read failed:", err);
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
    else if (t === "letta") chain.push(new LettaAdapter());
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
