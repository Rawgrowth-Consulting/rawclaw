import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";

import {
  selectChatBlocks,
  describeSelection,
  type ChatBlock,
} from "../../src/lib/agent/context";

const noop = async () => null;

const REQUIRED_A: ChatBlock = {
  id: "req-a",
  build: noop,
  defaultCostTokens: 500,
  priority: "required",
};
const REQUIRED_B: ChatBlock = {
  id: "req-b",
  build: noop,
  defaultCostTokens: 700,
  priority: "required",
};
const SKIP_A: ChatBlock = {
  id: "skip-a",
  build: noop,
  defaultCostTokens: 300,
  priority: "skippable",
};
const SKIP_B: ChatBlock = {
  id: "skip-b",
  build: noop,
  defaultCostTokens: 200,
  priority: "skippable",
};
const SKIP_C: ChatBlock = {
  id: "skip-c",
  build: noop,
  defaultCostTokens: 400,
  priority: "skippable",
};

const FIXTURE: ChatBlock[] = [REQUIRED_A, SKIP_A, REQUIRED_B, SKIP_B, SKIP_C];

test("selectChatBlocks: no budget option = pass-through", () => {
  const out = selectChatBlocks(FIXTURE);
  assert.deepEqual(
    out.map((b) => b.id),
    ["req-a", "skip-a", "req-b", "skip-b", "skip-c"],
  );
});

test("selectChatBlocks: infinite budget = pass-through", () => {
  const out = selectChatBlocks(FIXTURE, {
    skippableBudgetTokens: Number.POSITIVE_INFINITY,
  });
  assert.deepEqual(
    out.map((b) => b.id),
    ["req-a", "skip-a", "req-b", "skip-b", "skip-c"],
  );
});

test("selectChatBlocks: tight budget drops skippable in registry order", () => {
  const out = selectChatBlocks(FIXTURE, { skippableBudgetTokens: 350 });
  // skip-a (300) fits -> kept. skip-b (200) -> 500 > 350 -> dropped.
  // skip-c (400) -> 700 > 350 -> dropped. Required always pass.
  assert.deepEqual(
    out.map((b) => b.id),
    ["req-a", "skip-a", "req-b"],
  );
});

test("selectChatBlocks: zero budget drops ALL skippable", () => {
  const out = selectChatBlocks(FIXTURE, { skippableBudgetTokens: 0 });
  assert.deepEqual(
    out.map((b) => b.id),
    ["req-a", "req-b"],
  );
});

test("selectChatBlocks: budget exactly fits one skippable", () => {
  const out = selectChatBlocks(FIXTURE, { skippableBudgetTokens: 500 });
  // skip-a (300) fits -> kept (spent=300). skip-b (200) -> 500 ≤ 500
  // -> kept (spent=500). skip-c (400) -> 900 > 500 -> dropped.
  assert.deepEqual(
    out.map((b) => b.id),
    ["req-a", "skip-a", "req-b", "skip-b"],
  );
});

test("selectChatBlocks: missing defaultCostTokens treated as 0 (always include skippable)", () => {
  const cheap: ChatBlock = {
    id: "cheap",
    build: noop,
    priority: "skippable",
  };
  const out = selectChatBlocks([REQUIRED_A, cheap], {
    skippableBudgetTokens: 0,
  });
  assert.deepEqual(
    out.map((b) => b.id),
    ["req-a", "cheap"],
  );
});

test("selectChatBlocks: missing priority treated as required (always include)", () => {
  const noPriority: ChatBlock = {
    id: "no-prio",
    build: noop,
    defaultCostTokens: 999_999,
  };
  const out = selectChatBlocks([noPriority], { skippableBudgetTokens: 0 });
  assert.deepEqual(
    out.map((b) => b.id),
    ["no-prio"],
  );
});

test("selectChatBlocks: negative budget = pass-through (safety)", () => {
  const out = selectChatBlocks(FIXTURE, { skippableBudgetTokens: -1 });
  assert.equal(out.length, FIXTURE.length);
});

test("selectChatBlocks: mode filter drops blocks that opt-out", () => {
  const chatOnly: ChatBlock = {
    id: "chat-only",
    build: noop,
    priority: "required",
    modes: ["chat"],
  };
  const telegramOnly: ChatBlock = {
    id: "tg-only",
    build: noop,
    priority: "required",
    modes: ["telegram"],
  };
  const both: ChatBlock = {
    id: "both",
    build: noop,
    priority: "required",
    modes: ["chat", "telegram"],
  };
  const noLimit: ChatBlock = {
    id: "no-modes",
    build: noop,
    priority: "required",
  };
  const blocks = [chatOnly, telegramOnly, both, noLimit];

  const chatOut = selectChatBlocks(blocks, { mode: "chat" }).map((b) => b.id);
  assert.deepEqual(chatOut, ["chat-only", "both", "no-modes"]);

  const telegramOut = selectChatBlocks(blocks, { mode: "telegram" }).map(
    (b) => b.id,
  );
  assert.deepEqual(telegramOut, ["tg-only", "both", "no-modes"]);

  const noMode = selectChatBlocks(blocks).map((b) => b.id);
  assert.deepEqual(noMode, ["chat-only", "tg-only", "both", "no-modes"]);
});

test("selectChatBlocks: mode filter + budget compose correctly", () => {
  const expensiveChatOnly: ChatBlock = {
    id: "ex-chat",
    build: noop,
    priority: "skippable",
    defaultCostTokens: 1000,
    modes: ["chat"],
  };
  const cheapTelegram: ChatBlock = {
    id: "ch-tg",
    build: noop,
    priority: "skippable",
    defaultCostTokens: 50,
    modes: ["telegram"],
  };
  const required: ChatBlock = {
    id: "req",
    build: noop,
    priority: "required",
  };
  const blocks = [required, expensiveChatOnly, cheapTelegram];

  // Telegram mode + 200 budget: ex-chat filtered by mode, ch-tg fits.
  const tg = selectChatBlocks(blocks, {
    mode: "telegram",
    skippableBudgetTokens: 200,
  }).map((b) => b.id);
  assert.deepEqual(tg, ["req", "ch-tg"]);

  // Chat mode + 200 budget: ex-chat over budget, ch-tg filtered by mode.
  const chat = selectChatBlocks(blocks, {
    mode: "chat",
    skippableBudgetTokens: 200,
  }).map((b) => b.id);
  assert.deepEqual(chat, ["req"]);
});

test("describeSelection: reports selected + skipped with reason", () => {
  const cheapMode: ChatBlock = {
    id: "cheap-chat",
    build: noop,
    priority: "skippable",
    defaultCostTokens: 50,
    modes: ["chat"],
  };
  const expensive: ChatBlock = {
    id: "ex",
    build: noop,
    priority: "skippable",
    defaultCostTokens: 1000,
  };
  const required: ChatBlock = {
    id: "req",
    build: noop,
    priority: "required",
    defaultCostTokens: 100,
  };

  const decision = describeSelection(
    [required, cheapMode, expensive],
    { mode: "telegram", skippableBudgetTokens: 500 },
  );

  // cheapMode dropped by mode, expensive dropped by budget, req kept.
  assert.deepEqual(
    decision.selected.map((s) => s.id),
    ["req"],
  );
  assert.deepEqual(
    decision.skipped.map((s) => ({ id: s.id, reason: s.reason })),
    [
      { id: "cheap-chat", reason: "mode" },
      { id: "ex", reason: "budget" },
    ],
  );
  assert.equal(decision.totalSelectedCost, 100);
  assert.equal(decision.totalSkippedCost, 1050);
});

test("describeSelection: full budget keeps everything (no reason marked)", () => {
  const required: ChatBlock = {
    id: "req",
    build: noop,
    priority: "required",
    defaultCostTokens: 200,
  };
  const skip: ChatBlock = {
    id: "skip",
    build: noop,
    priority: "skippable",
    defaultCostTokens: 300,
  };
  const decision = describeSelection([required, skip]);
  assert.equal(decision.skipped.length, 0);
  assert.deepEqual(
    decision.selected.map((s) => s.id),
    ["req", "skip"],
  );
  assert.equal(decision.totalSelectedCost, 500);
});

test("describeSelection: budget exactly matches one skippable", () => {
  const required: ChatBlock = {
    id: "req",
    build: noop,
    priority: "required",
    defaultCostTokens: 50,
  };
  const a: ChatBlock = {
    id: "a",
    build: noop,
    priority: "skippable",
    defaultCostTokens: 100,
  };
  const b: ChatBlock = {
    id: "b",
    build: noop,
    priority: "skippable",
    defaultCostTokens: 100,
  };
  const decision = describeSelection([required, a, b], {
    skippableBudgetTokens: 100,
  });
  assert.deepEqual(
    decision.selected.map((s) => s.id),
    ["req", "a"],
  );
  assert.deepEqual(
    decision.skipped.map((s) => ({ id: s.id, reason: s.reason })),
    [{ id: "b", reason: "budget" }],
  );
});
