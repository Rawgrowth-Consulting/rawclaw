import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";

import { selectChatBlocks, type ChatBlock } from "../../src/lib/agent/context";

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
