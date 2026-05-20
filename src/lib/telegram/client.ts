/**
 * Minimal Telegram Bot API client. We only need a few endpoints:
 *   - getMe          → validate a bot token + display the bot identity
 *   - setWebhook     → point Telegram at our /api/webhooks/telegram/[id]
 *   - deleteWebhook  → clean up on disconnect
 *   - sendMessage    → reply to the user after a routine fires
 *
 * No SDK dependency  -  fetch + JSON is enough.
 */

const API_ROOT = "https://api.telegram.org";

type TgResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

async function call<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  // 15s ceiling per Telegram API call. The drain server fans out
  // multiple of these per webhook (typing indicator + edit message
  // + send), so unbounded stalls would compound and miss Telegram's
  // 60s webhook delivery deadline.
  const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as TgResponse<T>;
  if (!json.ok) {
    throw new Error(
      `Telegram ${method} failed (${json.error_code ?? "?"}): ${json.description ?? "unknown error"}`,
    );
  }
  return json.result as T;
}

export type TgUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

export function getMe(token: string) {
  return call<TgUser>(token, "getMe");
}

export function setWebhook(token: string, url: string, secretToken?: string) {
  return call<true>(token, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message"],
  });
}

export function deleteWebhook(token: string) {
  return call<true>(token, "deleteWebhook");
}

/** The subset of the Telegram Message object we actually use. */
export type TgSentMessage = {
  message_id: number;
  chat: { id: number };
  date: number;
  text?: string;
};

/**
 * Send a fresh message. Retries WITHOUT parse_mode on Markdown validation
 * failures, mirroring editMessageText's fallback. Before this retry the
 * webhook fallback path (placeholder send failed -> sendMessage in catch)
 * would drop the operator's reply on the floor whenever the agent emitted
 * stray asterisks / underscores / backticks, because the route's outer
 * try/catch swallowed the parse error and the row was still marked
 * responded_at. Operator sees nothing back; debug log buried.
 */
export async function sendMessage(
  token: string,
  chatId: number | string,
  text: string,
) {
  try {
    return await call<TgSentMessage>(token, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (/parse|markdown|entities/i.test(msg)) {
      return await call<TgSentMessage>(token, "sendMessage", {
        chat_id: chatId,
        text,
      });
    }
    throw err;
  }
}

/**
 * Replace the contents of a message we previously sent. Use this to turn
 * a placeholder ("…") into the real agent reply once it arrives  -  Telegram
 * animates the swap, so from the user's side it looks like a speech bubble
 * that was thinking and then finished.
 *
 * Retries without parse_mode if Markdown validation fails (common when the
 * model emits stray asterisks or underscores).
 */
export async function editMessageText(
  token: string,
  chatId: number | string,
  messageId: number,
  text: string,
  opts?: { plain?: boolean },
) {
  // Streaming edits pass plain:true. Mid-stream text routinely holds
  // unbalanced Markdown (an open `**` before its close arrives), which
  // makes the parse_mode:"Markdown" attempt 400 on every tick and forces
  // the fallback - two API calls per frame, half of them wasted. Plain
  // text edits skip the parser entirely; the final non-streamed edit
  // (via sendChunkedReply) restores Markdown rendering.
  if (opts?.plain) {
    return await call<TgSentMessage>(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
    });
  }
  try {
    return await call<TgSentMessage>(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "Markdown",
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (/parse|markdown|entities/i.test(msg)) {
      return await call<TgSentMessage>(token, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
      });
    }
    throw err;
  }
}

/**
 * Show a "typing…" bubble in the chat HEADER (not inline). Auto-clears
 * after 5s or when the next message is sent. Use it for instant feedback
 * while the agent thinks  -  pairs well with the placeholder-then-edit
 * pattern in the webhook handler.
 */
export function sendChatAction(
  token: string,
  chatId: number | string,
  action: "typing" | "upload_photo" = "typing",
) {
  return call<true>(token, "sendChatAction", {
    chat_id: chatId,
    action,
  });
}

/**
 * Telegram hard-caps a single message at 4096 chars; anything longer is
 * rejected with a 400 and (in our after()-deferred reply path) silently
 * lost - the operator just saw the placeholder hang on "Thinking…".
 *
 * 2026-05-19 incident: multi-agent synthesis replies routinely exceed
 * 4096 chars, so every fan-out answer vanished. Split into <=3900-char
 * chunks (headroom for the "(i/N)\n\n" prefix added by sendChunkedReply)
 * at the last paragraph break ("\n\n") under the limit, falling back to
 * the last single newline, then a hard cut. Never returns an empty array.
 */
export const TG_CHUNK_LIMIT = 3900;

export function splitTelegramText(
  text: string,
  limit: number = TG_CHUNK_LIMIT,
): string[] {
  if (!text) return [""];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    // Prefer a paragraph boundary, then a line boundary, so we never cut
    // mid-sentence unless the text has no break in the whole window.
    let cut = window.lastIndexOf("\n\n");
    if (cut < limit * 0.5) cut = window.lastIndexOf("\n");
    if (cut <= 0) cut = limit; // hard cut: no break found in window
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks.length > 0 ? chunks : [""];
}

/**
 * Emit a (possibly long) agent reply to Telegram, transparently chunking
 * when it exceeds the 4096-char cap. The first chunk edits the placeholder
 * message (if one was sent) so the existing "thinking → answer" speech
 * bubble swap still works; remaining chunks are fresh sendMessage calls.
 * When there is more than one chunk each is prefixed with "(i/N)\n\n" so
 * the operator can see the reply continues.
 *
 * Added 2026-05-19 to fix silently-dropped long multi-agent replies.
 *
 * Hermes-pattern (NousResearch/hermes-agent gateway/platforms/telegram.py):
 * Telegram clears the "…typing" bubble the instant a new message lands, so
 * on a multi-chunk reply the indicator dies after chunk 1 and the operator
 * thinks the bot stalled. Re-trigger sendChatAction("typing") after each
 * non-final chunk so the bubble stays alive until the last part arrives.
 * Best-effort - typing failures never block the reply.
 */
export async function sendChunkedReply(
  token: string,
  chatId: number | string,
  text: string,
  placeholderId: number | null,
): Promise<void> {
  const parts = splitTelegramText(text);
  const total = parts.length;
  for (let i = 0; i < total; i++) {
    const prefix = total > 1 ? `(${i + 1}/${total})\n\n` : "";
    const body = prefix + parts[i];
    if (i === 0 && placeholderId !== null) {
      await editMessageText(token, chatId, placeholderId, body);
    } else {
      await sendMessage(token, chatId, body);
    }
    // Keep the typing bubble alive between chunks (Telegram clears it on
    // each delivered message). Skip after the final chunk - the reply is
    // done, no more is coming.
    if (i < total - 1) {
      void sendChatAction(token, chatId, "typing").catch(() => {});
    }
  }
}

/**
 * Live token-streaming editor for a Telegram placeholder message, modelled
 * on the Hermes gateway stream consumer (NousResearch/hermes-agent
 * gateway/platforms/telegram.py). The agent SDK emits the reply token by
 * token; this coalesces those deltas into throttled editMessageText calls so
 * the operator watches the answer type out in place instead of staring at a
 * frozen "Thinking…".
 *
 * Throttle rationale: Telegram's flood envelope for edits to one message is
 * ~1/sec; bursting faster earns a 429 + retry_after. We hold edits to one
 * per FRAME_MS and coalesce intermediate deltas, always editing with the
 * latest accumulated text on the trailing edge so nothing is skipped.
 *
 * - push(text): record the latest full accumulated text. Fires an edit now
 *   if the throttle window is open, else schedules a trailing edit.
 * - stop(): cancel any pending edit. The caller then sends the final,
 *   Markdown-rendered answer via sendChunkedReply (authoritative).
 *
 * Edits are plain-text (no parse_mode) - mid-stream Markdown is usually
 * unbalanced and would 400. A live "▍" cursor is appended so the bubble
 * reads as actively typing. Cut to TG_CHUNK_LIMIT so a long in-progress
 * answer never 400s on the 4096 cap; the final sendChunkedReply handles
 * real chunking. All failures are swallowed - streaming is best-effort and
 * must never block or crash the reply path.
 */
const STREAM_FRAME_MS = 1100;
const STREAM_CURSOR = " ▍";

export function createStreamingEditor(
  token: string,
  chatId: number | string,
  messageId: number,
): { push: (text: string) => void; stop: () => void } {
  let latest = "";
  let rendered = "";
  let lastEditAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let stopped = false;

  const flush = () => {
    timer = null;
    if (stopped || inFlight) return;
    const trimmed = latest.trim();
    if (!trimmed || trimmed === rendered) return;
    rendered = trimmed;
    lastEditAt = Date.now();
    inFlight = true;
    const body =
      (trimmed.length > TG_CHUNK_LIMIT ? trimmed.slice(0, TG_CHUNK_LIMIT) : trimmed) +
      STREAM_CURSOR;
    void editMessageText(token, chatId, messageId, body, { plain: true })
      .catch(() => {})
      .finally(() => {
        inFlight = false;
        // A delta may have arrived while the edit was in flight - drain it
        // on the next frame so the final streamed frame is never stale.
        if (!stopped && latest.trim() !== rendered && timer === null) {
          schedule();
        }
      });
  };

  const schedule = () => {
    if (stopped || timer !== null) return;
    const wait = Math.max(0, STREAM_FRAME_MS - (Date.now() - lastEditAt));
    timer = setTimeout(flush, wait);
  };

  return {
    push(text: string) {
      if (stopped) return;
      latest = text;
      schedule();
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

// Shape of the inbound webhook payload (only fields we care about).
export type TgPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TgVoice = {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
};

export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    caption?: string;
    photo?: TgPhotoSize[];
    voice?: TgVoice;
  };
};

/**
 * Resolve a voice/document file_id into a download URL. Two hops:
 *   1. getFile returns { file_path }
 *   2. GET https://api.telegram.org/file/bot<TOKEN>/<file_path>
 */
export async function getFile(token: string, fileId: string) {
  return call<{
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_path?: string;
  }>(token, "getFile", { file_id: fileId });
}

export function fileDownloadUrl(token: string, filePath: string): string {
  return `${API_ROOT}/file/bot${token}/${filePath}`;
}

/**
 * Resolve a Telegram file_id to a downloadable file_path. Throws if Telegram
 * doesn't return one. Combine with downloadFile() below.
 */
export async function getFilePath(token: string, fileId: string): Promise<string> {
  const file = await getFile(token, fileId);
  if (!file.file_path) {
    throw new Error(`Telegram getFile returned no file_path for ${fileId}`);
  }
  return file.file_path;
}

/**
 * Download a Telegram-hosted file as raw bytes. Telegram caps this at 20MB
 * per request — voice notes and Telegram-compressed photos fit easily.
 */
export async function downloadFile(
  token: string,
  filePath: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetch(fileDownloadUrl(token, filePath), {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Telegram file download failed: ${res.status}`);
  }
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, mimeType };
}
