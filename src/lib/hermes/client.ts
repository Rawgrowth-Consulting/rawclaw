/**
 * Hermes Agent dashboard HTTP + WebSocket client.
 *
 * Wraps the actual Hermes dashboard API surface discovered on 0.14.0:
 *
 *   REST   /api/status                       healthcheck (no auth)
 *   REST   /api/profiles                     list + create profiles
 *   REST   /api/profiles/{name}              patch + delete profile
 *   REST   /api/profiles/{name}/soul         get + put system prompt
 *   REST   /api/cron/jobs                    list + create scheduled prompts
 *   REST   /api/cron/jobs/{id}               get/put/delete
 *   REST   /api/cron/jobs/{id}/{pause,resume,trigger}
 *   REST   /api/sessions                     list past chat sessions
 *   REST   /api/sessions/{id}/messages       read message history
 *   REST   /api/skills                       list + toggle bundled skills
 *   REST   /api/tools/toolsets               list tool sets
 *   WS     /api/ws                           JSON-RPC chat sidecar (live)
 *   WS     /api/events                       gateway event firehose
 *   WS     /api/pty                          interactive terminal (for ops)
 *
 * Auth: dashboard requires a Bearer token. Read `HERMES_DASHBOARD_TOKEN`
 * from `/root/.hermes/.env` on the VPS (printed by `hermes dashboard --setup`).
 *
 * Default base URL: http://127.0.0.1:9119 (the dashboard listens on
 * loopback by default; expose externally only via the Caddy reverse
 * proxy with a separate auth layer).
 */

const DEFAULT_DASHBOARD_URL = "http://127.0.0.1:9119";

export interface HermesConfig {
  dashboardUrl: string;
  token: string;
  defaultProfile?: string;
}

export function getHermesConfig(): HermesConfig {
  const dashboardUrl =
    process.env.HERMES_DASHBOARD_URL?.trim() || DEFAULT_DASHBOARD_URL;
  const token = process.env.HERMES_DASHBOARD_TOKEN?.trim() || "";
  if (!token && process.env.NODE_ENV === "production") {
    throw new Error(
      "[hermes] HERMES_DASHBOARD_TOKEN is not set in production. Read it from /root/.hermes/.env on the VPS (hermes dashboard --setup prints it).",
    );
  }
  return {
    dashboardUrl,
    token,
    defaultProfile: process.env.HERMES_DEFAULT_PROFILE?.trim() || undefined,
  };
}

function headers(extra: Record<string, string> = {}): HeadersInit {
  const config = getHermesConfig();
  const h: Record<string, string> = {
    Accept: "application/json",
    ...extra,
  };
  if (config.token) h.Authorization = `Bearer ${config.token}`;
  return h;
}

/* -------------------------------------------------------------------- */
/* Status                                                                */
/* -------------------------------------------------------------------- */

export interface HermesStatus {
  version: string;
  release_date: string;
  hermes_home: string;
  config_version: number;
  latest_config_version: number;
  gateway_running: boolean;
  gateway_pid: number | null;
  gateway_state: string;
  gateway_platforms: Record<
    string,
    { state: string; error_code: string | null; error_message: string | null; updated_at: string }
  >;
  active_sessions: number;
}

export async function getStatus(): Promise<HermesStatus> {
  const config = getHermesConfig();
  const res = await fetch(`${config.dashboardUrl}/api/status`);
  if (!res.ok) throw new Error(`[hermes] /api/status: ${res.status}`);
  return (await res.json()) as HermesStatus;
}

/* -------------------------------------------------------------------- */
/* Profiles                                                              */
/* -------------------------------------------------------------------- */

export interface HermesProfileSummary {
  name: string;
  description?: string;
  is_default?: boolean;
}

export const hermesProfiles = {
  async list(): Promise<HermesProfileSummary[]> {
    const config = getHermesConfig();
    const res = await fetch(`${config.dashboardUrl}/api/profiles`, {
      headers: headers(),
    });
    if (!res.ok) throw new Error(`[hermes] list profiles: ${res.status}`);
    const data = (await res.json()) as
      | HermesProfileSummary[]
      | { profiles?: HermesProfileSummary[] };
    return Array.isArray(data) ? data : data.profiles ?? [];
  },

  /** Create a profile (optionally clone from default). */
  async create(input: {
    name: string;
    clone_from_default?: boolean;
    no_skills?: boolean;
  }): Promise<void> {
    const config = getHermesConfig();
    const res = await fetch(`${config.dashboardUrl}/api/profiles`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`[hermes] create profile: ${res.status}`);
  },

  /** Update profile metadata (rename, description, etc.). */
  async patch(name: string, patch: Record<string, unknown>): Promise<void> {
    const config = getHermesConfig();
    const res = await fetch(
      `${config.dashboardUrl}/api/profiles/${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) throw new Error(`[hermes] patch profile: ${res.status}`);
  },

  /** Read or set the system prompt ("soul") of a profile. */
  async getSoul(name: string): Promise<string> {
    const config = getHermesConfig();
    const res = await fetch(
      `${config.dashboardUrl}/api/profiles/${encodeURIComponent(name)}/soul`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error(`[hermes] get soul: ${res.status}`);
    const data = (await res.json()) as { soul?: string; system_prompt?: string };
    return data.soul ?? data.system_prompt ?? "";
  },

  async putSoul(name: string, systemPrompt: string): Promise<void> {
    const config = getHermesConfig();
    const res = await fetch(
      `${config.dashboardUrl}/api/profiles/${encodeURIComponent(name)}/soul`,
      {
        method: "PUT",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ soul: systemPrompt }),
      },
    );
    if (!res.ok) throw new Error(`[hermes] put soul: ${res.status}`);
  },

  async remove(name: string): Promise<void> {
    const config = getHermesConfig();
    const res = await fetch(
      `${config.dashboardUrl}/api/profiles/${encodeURIComponent(name)}`,
      { method: "DELETE", headers: headers() },
    );
    if (!res.ok) throw new Error(`[hermes] delete profile: ${res.status}`);
  },
};

/* -------------------------------------------------------------------- */
/* Cron jobs (replaces v3 drain server + rgaios_routine_runs)            */
/* -------------------------------------------------------------------- */

export interface HermesCronJob {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  profile?: string;
  paused?: boolean;
  created_at: string;
  updated_at: string;
}

export const hermesJobs = {
  async list(): Promise<HermesCronJob[]> {
    const config = getHermesConfig();
    const res = await fetch(`${config.dashboardUrl}/api/cron/jobs`, {
      headers: headers(),
    });
    if (!res.ok) throw new Error(`[hermes] list jobs: ${res.status}`);
    return (await res.json()) as HermesCronJob[];
  },

  async create(spec: Omit<HermesCronJob, "id" | "created_at" | "updated_at">): Promise<HermesCronJob> {
    const config = getHermesConfig();
    const res = await fetch(`${config.dashboardUrl}/api/cron/jobs`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(spec),
    });
    if (!res.ok) throw new Error(`[hermes] create job: ${res.status}`);
    return (await res.json()) as HermesCronJob;
  },

  async update(id: string, patch: Partial<HermesCronJob>): Promise<void> {
    const config = getHermesConfig();
    const res = await fetch(`${config.dashboardUrl}/api/cron/jobs/${id}`, {
      method: "PUT",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`[hermes] update job: ${res.status}`);
  },

  async remove(id: string): Promise<void> {
    const config = getHermesConfig();
    const res = await fetch(`${config.dashboardUrl}/api/cron/jobs/${id}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok) throw new Error(`[hermes] delete job: ${res.status}`);
  },

  async pause(id: string): Promise<void> {
    await fireAction(`/api/cron/jobs/${id}/pause`);
  },
  async resume(id: string): Promise<void> {
    await fireAction(`/api/cron/jobs/${id}/resume`);
  },
  async trigger(id: string): Promise<void> {
    await fireAction(`/api/cron/jobs/${id}/trigger`);
  },
};

async function fireAction(path: string): Promise<void> {
  const config = getHermesConfig();
  const res = await fetch(`${config.dashboardUrl}${path}`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`[hermes] ${path}: ${res.status}`);
}

/* -------------------------------------------------------------------- */
/* Sessions + messages (READ-only via REST, write via /api/ws)            */
/* -------------------------------------------------------------------- */

export interface HermesSessionSummary {
  id: string;
  profile?: string;
  created_at: string;
  updated_at: string;
  title?: string | null;
  message_count?: number;
}

export interface HermesMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export const hermesSessions = {
  async list(limit = 20, offset = 0): Promise<HermesSessionSummary[]> {
    const config = getHermesConfig();
    const res = await fetch(
      `${config.dashboardUrl}/api/sessions?limit=${limit}&offset=${offset}`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error(`[hermes] list sessions: ${res.status}`);
    const data = (await res.json()) as
      | HermesSessionSummary[]
      | { sessions?: HermesSessionSummary[] };
    return Array.isArray(data) ? data : data.sessions ?? [];
  },

  async messages(sessionId: string): Promise<HermesMessage[]> {
    const config = getHermesConfig();
    const res = await fetch(
      `${config.dashboardUrl}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error(`[hermes] session messages: ${res.status}`);
    const data = (await res.json()) as
      | HermesMessage[]
      | { messages?: HermesMessage[] };
    return Array.isArray(data) ? data : data.messages ?? [];
  },

  async remove(sessionId: string): Promise<void> {
    const config = getHermesConfig();
    const res = await fetch(
      `${config.dashboardUrl}/api/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE", headers: headers() },
    );
    if (!res.ok) throw new Error(`[hermes] delete session: ${res.status}`);
  },
};

/* -------------------------------------------------------------------- */
/* Chat: JSON-RPC WebSocket bridge on /api/ws                            */
/* -------------------------------------------------------------------- */

export type HermesChatEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; name: string; arguments?: unknown }
  | { type: "tool_call_end"; name: string; result?: unknown }
  | { type: "thinking"; text: string }
  | { type: "done"; final_text: string }
  | { type: "error"; message: string };

export interface HermesChatRequest {
  prompt: string;
  profile?: string;
  session?: string;
  onEvent?: (event: HermesChatEvent) => void;
  signal?: AbortSignal;
}

/**
 * Open a JSON-RPC WebSocket to /api/ws, send a chat request, accumulate
 * deltas into a final reply, translate each frame into the
 * HermesChatEvent union for the caller.
 *
 * The Hermes 0.14 dashboard speaks a JSON-RPC 2.0 frame shape on
 * /api/ws. The schema below is the closest stable surface I could
 * reverse out of `hermes_cli/web_server.py` line 3513-3554; if the
 * upstream changes shape, adjust the `mapFrame` switch and the
 * outbound `chat.send` method name.
 */
export async function hermesChat(req: HermesChatRequest): Promise<{
  reply: string;
}> {
  const config = getHermesConfig();
  const wsUrl =
    config.dashboardUrl.replace(/^http/i, "ws") + "/api/ws" +
    (config.token ? `?token=${encodeURIComponent(config.token)}` : "");

  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      reject(err);
      return;
    }
    let accumulated = "";
    let id = 0;

    const cleanup = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };

    if (req.signal) {
      req.signal.addEventListener("abort", () => {
        cleanup();
        reject(new Error("aborted"));
      });
    }

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: ++id,
          method: "chat.send",
          params: {
            input: req.prompt,
            profile: req.profile ?? config.defaultProfile,
            session: req.session,
          },
        }),
      );
    };

    ws.onmessage = (e: MessageEvent) => {
      let frame: unknown;
      try {
        frame = JSON.parse(typeof e.data === "string" ? e.data : "");
      } catch {
        return;
      }
      const event = mapFrame(frame);
      if (!event) return;
      req.onEvent?.(event);
      if (event.type === "text_delta") accumulated += event.text;
      else if (event.type === "done") {
        accumulated = event.final_text || accumulated;
        cleanup();
        resolve({ reply: accumulated });
      } else if (event.type === "error") {
        cleanup();
        reject(new Error(event.message));
      }
    };

    ws.onerror = (err: Event) => {
      cleanup();
      reject(new Error("[hermes] ws error: " + JSON.stringify(err)));
    };
    ws.onclose = () => {
      if (accumulated) resolve({ reply: accumulated });
    };
  });
}

function mapFrame(raw: unknown): HermesChatEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  // JSON-RPC notifications: { method, params }
  const method = typeof f.method === "string" ? f.method : "";
  const params = (f.params ?? {}) as Record<string, unknown>;
  switch (method) {
    case "chat.text_delta":
    case "text_delta":
      return {
        type: "text_delta",
        text: typeof params.delta === "string" ? params.delta : "",
      };
    case "chat.thinking":
    case "thinking":
      return {
        type: "thinking",
        text: typeof params.text === "string" ? params.text : "",
      };
    case "chat.tool_call_start":
    case "tool_call_start":
      return {
        type: "tool_call_start",
        name: typeof params.name === "string" ? params.name : "(unknown)",
        arguments: params.arguments,
      };
    case "chat.tool_call_end":
    case "tool_call_end":
      return {
        type: "tool_call_end",
        name: typeof params.name === "string" ? params.name : "(unknown)",
        result: params.result,
      };
    case "chat.done":
    case "done":
      return {
        type: "done",
        final_text: typeof params.output === "string" ? params.output : "",
      };
    case "chat.error":
    case "error":
      return {
        type: "error",
        message:
          typeof params.message === "string" ? params.message : "unknown",
      };
    default:
      // JSON-RPC response: { result } or { error }
      if (f.error)
        return {
          type: "error",
          message: JSON.stringify(f.error).slice(0, 200),
        };
      return null;
  }
}
