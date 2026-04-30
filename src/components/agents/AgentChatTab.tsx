"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ArrowUp, Paperclip } from "lucide-react";

import { Response } from "@/components/ui/response";
import { Button } from "@/components/ui/button";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type HistoryRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

interface AgentChatTabProps {
  agentId: string;
}

/**
 * AgentChatTab
 *
 * Mirrors src/app/onboarding/OnboardingChat.tsx UX. Single-thread chat
 * with a per-agent server. Hydrates history from GET
 * /api/agents/[id]/chat, posts new turns to POST /api/agents/[id]/chat
 * which streams newline-delimited JSON events:
 *   { type: "text",  delta: string }
 *   { type: "done" }
 *   { type: "error", message: string }
 *
 * Drag-drop on the bubble pane uploads the file as an agent file via
 * POST /api/agent-files/upload (multipart). The pipeline chunks +
 * embeds inline so the next reply can RAG-cite it. We surface the
 * upload result as a system bubble so the operator sees what happened.
 */
export default function AgentChatTab({ agentId }: AgentChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Hydrate prior conversation from server. Failures are non-fatal -
  // a fresh thread just starts empty.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${agentId}/chat`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data: { messages?: HistoryRow[] }) => {
        if (cancelled) return;
        const rows = Array.isArray(data.messages) ? data.messages : [];
        setMessages(
          rows.map((m) => ({ role: m.role, content: m.content })),
        );
        setHydrated(true);
      })
      .catch(() => {
        if (cancelled) return;
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // Auto-scroll on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  async function sendMessage(override?: string) {
    const text = (override ?? input).trim();
    if (!text || streaming) return;
    setError("");
    if (override === undefined) setInput("");

    const next: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ];
    setMessages(next);
    setStreaming(true);

    try {
      // Wire shape mirrors onboarding chat: send only user/assistant
      // turns with non-empty content. Strip the empty trailing
      // assistant placeholder we just pushed for UX.
      const wireMessages = next
        .slice(0, -1)
        .filter(
          (m): m is { role: "user" | "assistant"; content: string } =>
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            m.content.trim().length > 0,
        );

      const res = await fetch(`/api/agents/${agentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: wireMessages }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- streamed JSON event from internal API; narrowed at each branch
          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "text" && typeof event.delta === "string") {
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = {
                  role: "assistant",
                  content: last.content + event.delta,
                };
              } else {
                copy.push({ role: "assistant", content: event.delta });
              }
              return copy;
            });
          } else if (event.type === "error") {
            setError(event.message || "Stream error");
          }
          // event.type === "done" is implicit; the reader exits when
          // the server closes the stream.
        }
      }

      // Drop trailing empty placeholder if the server closed without
      // text (rare; e.g. brand-voice hard fail with no visible reply).
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && !last.content.trim()) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  async function uploadFiles(picked: FileList | File[]) {
    const arr = Array.from(picked);
    if (arr.length === 0) return;
    setUploading(true);
    setError("");
    let okCount = 0;
    let totalChunks = 0;
    const errs: string[] = [];
    for (const f of arr) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("agent_id", agentId);
        const res = await fetch("/api/agent-files/upload", {
          method: "POST",
          body: fd,
        });
        const j = (await res.json().catch(() => ({}))) as {
          file_id?: string;
          chunk_count?: number;
          error?: string;
        };
        if (!res.ok) {
          errs.push(`${f.name}: ${j.error ?? res.statusText}`);
          continue;
        }
        okCount += 1;
        totalChunks += j.chunk_count ?? 0;
      } catch (err) {
        errs.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    setUploading(false);
    const summary = okCount > 0
      ? `Uploaded ${okCount} file${okCount === 1 ? "" : "s"} (${totalChunks} chunks indexed). Ask me anything about ${okCount === 1 ? "it" : "them"}.`
      : null;
    if (summary) {
      setMessages((prev) => [...prev, { role: "system", content: summary }]);
    }
    if (errs.length > 0) setError(errs.join("; "));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div
      data-onboarding="agent-chat"
      className="flex h-full flex-col"
      onDragEnter={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragActive(false);
        if (e.dataTransfer.files?.length) {
          void uploadFiles(e.dataTransfer.files);
        }
      }}
    >
      {/* Drag overlay */}
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-[var(--brand-primary)] bg-[var(--brand-primary-soft)]">
          <p className="text-sm text-[var(--brand-primary)]">
            Drop file to upload as agent context
          </p>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto max-w-2xl space-y-5 py-6">
          {!hydrated && (
            <p className="text-center text-xs text-[var(--text-muted)]">
              Loading conversation...
            </p>
          )}
          {hydrated && messages.length === 0 && (
            <div className="rounded-md border border-dashed border-[var(--line)] bg-[var(--brand-surface)]/40 p-6 text-center text-sm text-[var(--text-muted)]">
              No messages yet. Ask this agent anything, or drop a file to
              add it to its memory.
            </div>
          )}
          {messages.map((msg, i) => (
            <Bubble
              key={i}
              message={msg}
              streaming={streaming && i === messages.length - 1}
            />
          ))}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-[var(--line)] bg-[var(--brand-bg)]/80 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-end gap-2 rounded-2xl border border-[var(--line-strong)] bg-[var(--brand-surface)] p-2 focus-within:border-[var(--brand-primary)]">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || streaming}
              aria-label="Attach file"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:text-[var(--brand-primary)] disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.md,.markdown,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain,text/csv,image/*"
              hidden
              onChange={(e) => {
                if (e.target.files?.length) {
                  void uploadFiles(e.target.files);
                }
                e.target.value = "";
              }}
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={
                uploading ? "Uploading file..." : "Talk to this agent..."
              }
              disabled={streaming || uploading}
              className="min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-[var(--text-muted)] outline-none disabled:opacity-60"
            />
            <Button
              type="button"
              size="icon"
              onClick={() => sendMessage()}
              disabled={!input.trim() || streaming || uploading}
              aria-label="Send message"
              className="h-9 w-9 shrink-0 rounded-xl"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-[var(--text-muted)]">
            Drag-drop a file to add it to this agent&apos;s memory. Press
            Enter to send, Shift+Enter for newline.
          </p>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end" data-role="user">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--brand-primary-soft)] px-4 py-2.5 text-sm text-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === "system") {
    return (
      <div className="flex justify-center" data-role="system">
        <div className="rounded-full border border-[var(--line)] bg-[var(--brand-surface)]/60 px-3 py-1 text-[11px] text-[var(--text-muted)]">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3" data-role="assistant">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-primary-soft)]">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--brand-primary)]">
          AI
        </span>
      </div>
      <div className="min-w-0 flex-1 pt-0.5 text-sm leading-relaxed text-[var(--text-body)]">
        {message.content ? (
          <Response>{message.content}</Response>
        ) : streaming ? (
          <span className="inline-flex h-3 items-center gap-1 text-[var(--text-muted)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:.15s]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:.3s]" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

