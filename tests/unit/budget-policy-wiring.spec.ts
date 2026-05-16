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

test("chat route imports ROLE_BASED_BUDGET_POLICY + chatHistoryBudgetFactor", () => {
  assert.match(
    CHAT_ROUTE_SRC,
    /import \{[^}]*\bROLE_BASED_BUDGET_POLICY\b[^}]*\bchatHistoryBudgetFactor\b[^}]*\} from "@\/lib\/agent\/context"/,
    "chat route must import both budget helpers from context.ts",
  );
});

test("chat route budgetPolicy multiplies role base × history factor", () => {
  // The Math.round(ROLE_BASED_BUDGET_POLICY(flags) * chatHistoryBudgetFactor(messageCount))
  // shape is the iter 41 one-liner. Regex allows arbitrary whitespace
  // and the flags identifier name so a rename doesn't break it.
  assert.match(
    CHAT_ROUTE_SRC,
    /Math\.round\(\s*ROLE_BASED_BUDGET_POLICY\(\w+\)\s*\*\s*chatHistoryBudgetFactor\(\w+\)\s*,?\s*\)/,
    "chat route budgetPolicy must compose ROLE_BASED_BUDGET_POLICY * chatHistoryBudgetFactor",
  );
});

test("chat route passes telemetry: true to V2 preamble", () => {
  assert.match(
    CHAT_ROUTE_SRC,
    /telemetry:\s*true/,
    "chat route must keep telemetry: true so prod logs show budget drops",
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

test("telegram webhook passes telemetry: true", () => {
  assert.match(
    TELEGRAM_ROUTE_SRC,
    /telemetry:\s*true/,
    "telegram webhook must keep telemetry: true",
  );
});
