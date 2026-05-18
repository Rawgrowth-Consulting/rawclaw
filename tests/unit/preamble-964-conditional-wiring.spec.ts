import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guard rail for PR #129 (D TICK-86) - the non-CEO/non-head
 * preamble branch's `agent_invoke / routine_create` capability
 * statement at preamble.ts:964 (post-fix).
 *
 * Background: the pre-fix line read "You are NOT authorised to
 * emit agent_invoke or routine_create from this surface - those
 * route through Atlas / a department head." That copy was the
 * right shape for true specialists but lied whenever a real
 * dept-head's `is_department_head` DB flag was stale or wrong -
 * exactly what tripped Marti's EM at [A 23:43] and forced the
 * SQL fix at [D 03:57]. PR #129 replaced the lie with a truthful
 * conditional that names which roles have the capability + tells
 * specialists which lever they do have (`agent_message` async).
 *
 * Why a regex guard and not a behavioral test: the preamble is
 * static instruction text injected into the system prompt. The
 * regression we need to catch is "a future refactor restores the
 * lie or drops the truthful conditional". Source-level grep is
 * the right size of test for that contract; same pattern as
 * tests/unit/budget-policy-wiring.spec.ts +
 * tests/unit/chat-eager-synth-wiring.spec.ts.
 */

const SRC = readFileSync(
  resolve(__dirname, "../../src/lib/agent/preamble.ts"),
  "utf8",
);

test("preamble.ts no longer contains the 'NOT authorised to emit agent_invoke' lie (PR #129)", () => {
  // The exact pre-fix copy. A revert (or any refactor that
  // reintroduces it verbatim) flips this red.
  assert.doesNotMatch(
    SRC,
    /You are NOT authorised to emit agent_invoke or routine_create from this surface/,
    "preamble.ts must not contain the pre-PR-#129 capability lie - it misleads dept-heads whose is_department_head flag is mis-set",
  );
});

test("preamble.ts states the dept-heads + CEO agent_invoke conditional (PR #129)", () => {
  // The post-fix copy explicitly names both capability + the
  // specialist lever (agent_message). Pin both halves so a
  // partial revert can't hide.
  assert.match(
    SRC,
    /For dept-heads \+ CEO[\s\S]{0,200}agent_invoke[\s\S]{0,400}routine_create[\s\S]{0,400}specialists[\s\S]{0,400}agent_message/,
    "preamble.ts must keep the post-PR-#129 truthful conditional (dept-heads/CEO -> agent_invoke + routine_create; specialists -> agent_message)",
  );
});

test("preamble.ts anchors the agent_invoke authority on the runtime gate (PR #129)", () => {
  // The fix's load-bearing claim is "the runtime gate enforces"
  // (agent-commands.ts:1436-1449). Pin a reference to it so the
  // copy stays anchored to where the actual gate lives - if the
  // gate ever moves the comment + this test get updated together.
  assert.match(
    SRC,
    /runtime gate (will reject|enforces)/,
    "preamble.ts must reference the runtime gate so prompt copy stays anchored to actual enforcement",
  );
});
