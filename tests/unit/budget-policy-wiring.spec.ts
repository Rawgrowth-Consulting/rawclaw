import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";

// Iter 42 guard rail. The chat route + telegram webhook were
// wired to ROLE_BASED_BUDGET_POLICY (iter 36), the JSON-backed
// role tiers (iter 40), the JSON-backed history scale via
// chatHistoryBudgetFactor (iter 41), and the telemetry: true
// opt-in (iter 33). A future refactor that pulls one of these
// out — say, going back to a fixed skippableBudgetTokens — would
// silently regress the budget-policy ops-tunability.
//
// These specs pin the call-site contract via regex on the route
// sources. They complement the unit tests for the helpers
// themselves: those tests verify the math, these verify the math
// is actually wired in.

const CHAT_ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../src/app/api/agents/[id]/chat/route.ts"),
  "utf8",
);
const TELEGRAM_ROUTE_SRC = readFileSync(
  resolve(
    __dirname,
    "../../src/app/api/webhooks/agent-telegram/[botRowId]/route.ts",
  ),
  "utf8",
);

test("chat route imports computeChatBudget", () => {
  // Iter 43: ROLE_BASED_BUDGET_POLICY * chatHistoryBudgetFactor
  // collapsed into computeChatBudget. Chat route only needs the
  // composed helper.
  assert.match(
    CHAT_ROUTE_SRC,
    /import \{[^}]*\bcomputeChatBudget\b[^}]*\} from "@\/lib\/agent\/context"/,
    "chat route must import computeChatBudget from context.ts",
  );
});

test("chat route budgetPolicy delegates to computeChatBudget", () => {
  assert.match(
    CHAT_ROUTE_SRC,
    /budgetPolicy:\s*\(\w+\)\s*=>\s*computeChatBudget\(\w+,\s*\w+\)/,
    "chat route budgetPolicy must call computeChatBudget(flags, messageCount)",
  );
});

test("chat route wires telemetry to V2 preamble (true or persistChatTelemetry)", () => {
  // F-5 upgraded the legacy `telemetry: true` console.info wiring to a
  // persistChatTelemetry({ orgId, agentId, messageCount }) callback that
  // writes to rgaios_chat_telemetry. Either shape keeps the budget-drop
  // signal flowing. A future refactor that drops both would silently
  // regress prod observability of which blocks the budget gate cuts.
  assert.match(
    CHAT_ROUTE_SRC,
    /telemetry:\s*(true|persistChatTelemetry\()/,
    "chat route must pass telemetry (true OR persistChatTelemetry(...))",
  );
});

test("telegram webhook imports ROLE_BASED_BUDGET_POLICY", () => {
  assert.match(
    TELEGRAM_ROUTE_SRC,
    /import \{[^}]*\bROLE_BASED_BUDGET_POLICY\b[^}]*\} from "@\/lib\/agent\/context"/,
    "telegram webhook must import ROLE_BASED_BUDGET_POLICY",
  );
});

test("telegram webhook uses ROLE_BASED_BUDGET_POLICY directly as budgetPolicy", () => {
  // Telegram is single-turn lean - the iter 36 + iter 40 choice is
  // to pass the role policy directly with no history scaling, so a
  // CEO bot on Telegram gets the full role base.
  assert.match(
    TELEGRAM_ROUTE_SRC,
    /budgetPolicy:\s*ROLE_BASED_BUDGET_POLICY/,
    "telegram webhook must pass ROLE_BASED_BUDGET_POLICY as budgetPolicy",
  );
});

test("telegram webhook wires telemetry to V2 preamble (true or persistChatTelemetry)", () => {
  assert.match(
    TELEGRAM_ROUTE_SRC,
    /telemetry:\s*(true|persistChatTelemetry\()/,
    "telegram webhook must pass telemetry (true OR persistChatTelemetry(...))",
  );
});
