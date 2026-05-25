/**
 * Hermes Agent HTTP client.
 *
 * Thin wrapper around the Hermes gateway HTTP API. Two surfaces:
 *
 *   - `hermesResponses({ prompt, agentId, stream, signal, onEvent })`
 *     POSTs `/v1/responses`, streams the SSE response back through
 *     `onEvent` per parsed event. Returns the final assembled reply
 *     string when done.
 *
 *   - `hermesJobs.create({...})`, `hermesJobs.history(jobId)`, etc.
 *     CRUD on scheduled jobs (replaces the old drain server + routine_runs
 *     claim/complete cycle).
 *
 * Auth: bearer token from HERMES_API_KEY. Gateway URL from HERMES_GATEWAY_URL.
 *
 * One Hermes instance per VPS; the gateway URL points at the VPS that
 * owns the org's agent profile. Profile selection is by `agentId` -> agent
 * name -> profile name, resolved per request.
 */

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8642";

export interface HermesConfig {
  gatewayUrl: string;
  apiKey: string;
  defaultProfile?: string;
}

export function getHermesConfig(): HermesConfig {
  const gatewayUrl =
    process.env.HERMES_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL;
  const apiKey = process.env.HERMES_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new Error(
      "[hermes] HERMES_API_KEY is not set. Read it from /root/.hermes/.env on the VPS.",
    );
  }
  return {
    gatewayUrl,
    apiKey,
    defaultProfile: process.env.HERMES_DEFAULT_PROFILE?.trim() || undefined,
  };
}

/** A single parsed event from the Hermes SSE stream. */
export type HermesEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; name: string; arguments?: unknown }
  | { type: "tool_call_end"; name: string; result?: unknown }
  | { type: "thinking"; text: string }
  | { type: "spawn_agent"; profile: string; task: string }
  | { type: "done"; final_text: string; usage?: unknown }
  | { type: "error"; message: string }
  | { type: "raw"; data: unknown };

export interface HermesResponseInput {
  prompt: string;
  /** Agent name or profile name on the Hermes side. */
  profile?: string;
  /** Conversation id for memory threading. */
  conversation?: string;
  /** Force-disable streaming (gateway will buffer + return final JSON). */
  stream?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: HermesEvent) => void;
  /** Max turns for inline tool execution. Defaults to gateway config. */
  maxTurns?: number;
}

/**
 * POST /v1/responses, stream the SSE response, return the final reply text.
 * Translates Hermes-side event types to the discriminated `HermesEvent`
 * union so the dashboard's existing NDJSON consumer can keep its shape.
 */
export async function hermesResponses(input: HermesResponseInput): Promise<{
  reply: string;
  usage?: unknown;
}> {
  const config = getHermesConfig();
  const profile = input.profile || config.defaultProfile;
  const stream = input.stream ?? true;

  const body: Record<string, unknown> = {
    input: input.prompt,
    stream,
  };
  if (profile) body.profile = profile;
  if (input.conversation) body.conversation = input.conversation;
  if (input.maxTurns) body.max_turns = input.maxTurns;

  const res = await fetch(`${config.gatewayUrl}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: stream ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[hermes] HTTP ${res.status} from /v1/responses: ${text.slice(0, 200)}`,
    );
  }

  if (!stream || !res.body) {
    const json = (await res.json()) as { output?: string; usage?: unknown };
    return { reply: json.output ?? "", usage: json.usage };
  }

  // Parse the SSE stream incrementally
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let finalText = "";
  let usage: unknown;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = parseSseFrame(frame);
      if (!event) continue;
      input.onEvent?.(event);
      if (event.type === "text_delta") finalText += event.text;
      else if (event.type === "done") {
        finalText = event.final_text || finalText;
        usage = event.usage;
      } else if (event.type === "error") {
        throw new Error(`[hermes] gateway error: ${event.message}`);
      }
    }
  }

  return { reply: finalText, usage };
}

/**
 * Parse a single SSE frame (raw text of "data: ..." lines) into a
 * `HermesEvent`. Returns null for unknown / empty frames.
 *
 * Hermes gateway emits frames shaped like:
 *
 *   event: text_delta
 *   data: {"delta":"hello"}
 *
 *   event: tool_call.start
 *   data: {"name":"composio.gmail.search","arguments":{...}}
 *
 *   event: done
 *   data: {"output":"...","usage":{...}}
 *
 * Older Hermes versions emit OpenAI-compatible `data: {"choices":[...]}`
 * deltas, which we map to `text_delta` too.
 */
function parseSseFrame(frame: string): HermesEvent | null {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data || data === "[DONE]") return null;

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return { type: "raw", data };
  }

  const p = payload as Record<string, unknown>;
  switch (event) {
    case "text_delta": {
      const text = typeof p.delta === "string" ? p.delta : "";
      return { type: "text_delta", text };
    }
    case "thinking": {
      const text = typeof p.text === "string" ? p.text : "";
      return { type: "thinking", text };
    }
    case "tool_call.start":
    case "tool_call_start": {
      const name = typeof p.name === "string" ? p.name : "(unknown)";
      return { type: "tool_call_start", name, arguments: p.arguments };
    }
    case "tool_call.end":
    case "tool_call_end": {
      const name = typeof p.name === "string" ? p.name : "(unknown)";
      return { type: "tool_call_end", name, result: p.result };
    }
    case "spawn_agent": {
      const profile = typeof p.profile === "string" ? p.profile : "(unknown)";
      const task = typeof p.task === "string" ? p.task : "";
      return { type: "spawn_agent", profile, task };
    }
    case "done": {
      const finalText = typeof p.output === "string" ? p.output : "";
      return { type: "done", final_text: finalText, usage: p.usage };
    }
    case "error": {
      const message =
        typeof p.message === "string" ? p.message : "unknown error";
      return { type: "error", message };
    }
    case "message": {
      // OpenAI-compatible fallback: chunk with choices[].delta.content
      const choices = (p as { choices?: Array<Record<string, unknown>> })
        .choices;
      const delta = choices?.[0]?.delta as
        | { content?: string }
        | undefined;
      if (typeof delta?.content === "string") {
        return { type: "text_delta", text: delta.content };
      }
      return { type: "raw", data: p };
    }
    default:
      return { type: "raw", data: p };
  }
}

/* -------------------------------------------------------------------- */
/* Jobs API (replaces the old drain server + rgaios_routine_runs)        */
/* -------------------------------------------------------------------- */

export interface HermesJobSpec {
  name: string;
  schedule: string; // cron expression
  prompt: string;
  profile?: string;
  enabled?: boolean;
}

export interface HermesJob extends HermesJobSpec {
  id: string;
  created_at: string;
  updated_at: string;
}

export const hermesJobs = {
  async list(): Promise<HermesJob[]> {
    const config = getHermesConfig();
    const res = await fetch(`${config.gatewayUrl}/v1/jobs`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) throw new Error(`[hermes] list jobs: ${res.status}`);
    return (await res.json()) as HermesJob[];
  },

  async create(spec: HermesJobSpec): Promise<HermesJob> {
    const config = getHermesConfig();
    const res = await fetch(`${config.gatewayUrl}/v1/jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(spec),
    });
    if (!res.ok) throw new Error(`[hermes] create job: ${res.status}`);
    return (await res.json()) as HermesJob;
  },

  async update(id: string, patch: Partial<HermesJobSpec>): Promise<HermesJob> {
    const config = getHermesConfig();
    const res = await fetch(`${config.gatewayUrl}/v1/jobs/${id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`[hermes] update job: ${res.status}`);
    return (await res.json()) as HermesJob;
  },

  async remove(id: string): Promise<void> {
    const config = getHermesConfig();
    const res = await fetch(`${config.gatewayUrl}/v1/jobs/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) throw new Error(`[hermes] delete job: ${res.status}`);
  },

  async history(id: string): Promise<unknown[]> {
    const config = getHermesConfig();
    const res = await fetch(`${config.gatewayUrl}/v1/jobs/${id}/history`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) throw new Error(`[hermes] job history: ${res.status}`);
    return (await res.json()) as unknown[];
  },
};

/* -------------------------------------------------------------------- */
/* Profiles API (sync rgaios_agents -> Hermes profiles, idempotent)      */
/* -------------------------------------------------------------------- */

export interface HermesProfileSpec {
  name: string;
  system_prompt: string;
  model?: string;
  mcp_servers?: string[];
  skills?: string[];
}

export const hermesProfiles = {
  async list(): Promise<{ name: string }[]> {
    const config = getHermesConfig();
    const res = await fetch(`${config.gatewayUrl}/v1/profiles`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) throw new Error(`[hermes] list profiles: ${res.status}`);
    return (await res.json()) as { name: string }[];
  },

  async upsert(spec: HermesProfileSpec): Promise<void> {
    const config = getHermesConfig();
    const res = await fetch(
      `${config.gatewayUrl}/v1/profiles/${encodeURIComponent(spec.name)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(spec),
      },
    );
    if (!res.ok) throw new Error(`[hermes] upsert profile: ${res.status}`);
  },
};
