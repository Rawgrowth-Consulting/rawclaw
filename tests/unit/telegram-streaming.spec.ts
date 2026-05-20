import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createStreamingEditor,
  TG_CHUNK_LIMIT,
} from "../../src/lib/telegram/client";

type EditCall = { text: string; hasParse: boolean };

function mockFetch(): { calls: EditCall[]; restore: () => void } {
  const calls: EditCall[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({
      text: String(body.text ?? ""),
      hasParse: "parse_mode" in body,
    });
    return {
      json: async () => ({
        ok: true,
        result: { message_id: 1, chat: { id: 1 }, date: 0 },
      }),
    };
  }) as unknown as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = orig) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("streaming editor: first push edits immediately, plain, with cursor", async () => {
  const { calls, restore } = mockFetch();
  try {
    const ed = createStreamingEditor("tok", 1, 10);
    ed.push("hello");
    await sleep(60);
    ed.stop();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, "hello ▍");
    assert.equal(calls[0].hasParse, false, "stream edits must skip parse_mode");
  } finally {
    restore();
  }
});

test("streaming editor: coalesces rapid deltas, delivers latest on next frame", async () => {
  const { calls, restore } = mockFetch();
  try {
    const ed = createStreamingEditor("tok", 1, 10);
    ed.push("a");
    await sleep(60); // first immediate edit
    ed.push("b");
    ed.push("c"); // both inside the throttle window
    await sleep(1300); // wait past one frame
    ed.stop();
    assert.equal(calls.length, 2, "two edits: immediate + one coalesced frame");
    assert.equal(calls[0].text, "a ▍");
    assert.equal(calls[1].text, "c ▍", "coalesced edit uses the latest text");
  } finally {
    restore();
  }
});

test("streaming editor: stop() cancels a pending throttled edit", async () => {
  const { calls, restore } = mockFetch();
  try {
    const ed = createStreamingEditor("tok", 1, 10);
    ed.push("one");
    await sleep(60);
    ed.push("two"); // schedules a trailing edit ~1100ms out
    ed.stop(); // must cancel it
    await sleep(1300);
    assert.equal(calls.length, 1, "no edit after stop()");
    assert.equal(calls[0].text, "one ▍");
  } finally {
    restore();
  }
});

test("streaming editor: oversized in-progress text is cut to the chunk limit", async () => {
  const { calls, restore } = mockFetch();
  try {
    const ed = createStreamingEditor("tok", 1, 10);
    ed.push("x".repeat(TG_CHUNK_LIMIT + 500));
    await sleep(60);
    ed.stop();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].text.length, TG_CHUNK_LIMIT + " ▍".length);
    assert.ok(calls[0].text.endsWith(" ▍"));
  } finally {
    restore();
  }
});

test("streaming editor: heartbeat pulses a working footer when streaming stalls", async () => {
  const { calls, restore } = mockFetch();
  try {
    const ed = createStreamingEditor("tok", 1, 10);
    ed.push("Planning the launch");
    await sleep(60); // first stream frame (cursor)
    // No more tokens. After the stall window the heartbeat must keep the
    // bubble moving with a "working" footer instead of freezing.
    await sleep(3200);
    ed.stop();
    assert.ok(calls.length >= 2, "heartbeat fired at least one extra edit");
    assert.equal(calls[0].text, "Planning the launch ▍");
    assert.match(calls[calls.length - 1].text, /working.*·/);
    assert.ok(
      calls[calls.length - 1].text.startsWith("Planning the launch"),
      "heartbeat keeps the streamed text above the footer",
    );
  } finally {
    restore();
  }
});

test("streaming editor: setStatus surfaces a humanized tool label in the footer", async () => {
  const { calls, restore } = mockFetch();
  try {
    const ed = createStreamingEditor("tok", 1, 10);
    ed.push("Working on it");
    await sleep(60);
    ed.setStatus("delegate");
    await sleep(3200); // stall -> heartbeat shows the status
    ed.stop();
    assert.match(calls[calls.length - 1].text, /🔧 delegate ·/);
  } finally {
    restore();
  }
});

test("streaming editor: identical text is not re-sent", async () => {
  const { calls, restore } = mockFetch();
  try {
    const ed = createStreamingEditor("tok", 1, 10);
    ed.push("same");
    await sleep(60);
    ed.push("same"); // no change -> no second edit
    await sleep(1300);
    ed.stop();
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});
