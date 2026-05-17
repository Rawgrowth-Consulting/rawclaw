/**
 * Operator-facing jargon humanizer. Pure-string, no I/O - safe to
 * import from client components.
 *
 * The map covers internal tool names + protocol terms ("MCP",
 * "pass-2", "schema", "UUID", "coercion error") plus the
 * SCREAMING_SNAKE_CASE composio action enums (GMAIL_*, etc) that
 * agents sometimes name verbatim in their reasoning or visible
 * reply.
 *
 * Originally lived alongside extractThinking in thinking.ts.
 * Extracted here so the notification bell, sidebar badges, tool-
 * card chips, and any other operator surface can reuse the same
 * mapping without dragging in supabaseAdmin (a server-only import
 * that breaks a "use client" boundary).
 */

const JARGON_MAP: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bcoercion error\b/gi, replacement: "had a small hiccup" },
  { pattern: /\bUUID\b/g, replacement: "id" },
  { pattern: /\blookup ambiguity\b/gi, replacement: "name resolution" },
  { pattern: /\bdodge the\b/gi, replacement: "work around the" },
  { pattern: /\bMCP-direct\b/g, replacement: "internal" },
  { pattern: /\bMCP\b/g, replacement: "internal" },
  { pattern: /\bpass-2\b/g, replacement: "second turn" },
  { pattern: /\bpass-1\b/g, replacement: "first turn" },
  { pattern: /\bschema\b/g, replacement: "shape" },
  // Underscore-aware tool names.
  { pattern: /\bGMAIL_CREATE_EMAIL_DRAFT\b/gi, replacement: "save a Gmail draft" },
  { pattern: /\bGMAIL_SEND_EMAIL\b/gi, replacement: "send the email" },
  { pattern: /\bGMAIL_DELETE_DRAFT\b/gi, replacement: "delete the draft" },
  { pattern: /\bGOOGLECALENDAR_CREATE_EVENT\b/gi, replacement: "create a calendar event" },
  { pattern: /\bSLACK_SEND_MESSAGE\b/gi, replacement: "post in Slack" },
  { pattern: /\bcomposio_use_tool\b/gi, replacement: "use the integration" },
  { pattern: /\bcomposio_list_tools\b/gi, replacement: "list integration actions" },
  { pattern: /\bapify_top_reels_from_file\b/gi, replacement: "scrape reels from the creator list" },
  { pattern: /\bapify_run_actor\b/gi, replacement: "scrape" },
  { pattern: /\bapify_race_scrape\b/gi, replacement: "scrape" },
  { pattern: /\bapify_batch_scrape\b/gi, replacement: "scrape" },
  { pattern: /\bapify_start_run\b/gi, replacement: "start the scrape" },
  { pattern: /\bapify_poll_run\b/gi, replacement: "check the scrape" },
  { pattern: /\bapify_list_actor_runs\b/gi, replacement: "list scrape runs" },
  { pattern: /\bagents_update\b/gi, replacement: "update my settings" },
  { pattern: /\bagents_create\b/gi, replacement: "hire a new agent" },
  { pattern: /\bagents_fire\b/gi, replacement: "archive an agent" },
  { pattern: /\bagent_invoke\b/gi, replacement: "delegate" },
  { pattern: /\bagent_message\b/gi, replacement: "message a peer" },
  { pattern: /\bagent_inbox\b/gi, replacement: "check the inbox" },
  { pattern: /\bknowledge_query\b/gi, replacement: "search my files" },
  { pattern: /\bcompany_query\b/gi, replacement: "search the company corpus" },
  { pattern: /\blookup_my_files\b/gi, replacement: "list my files" },
  { pattern: /\blist_knowledge_files\b/gi, replacement: "list my files" },
  { pattern: /\bread_knowledge_file\b/gi, replacement: "read a file" },
  { pattern: /\blookup_brand_voice\b/gi, replacement: "check the brand voice" },
  { pattern: /\blookup_company_fact\b/gi, replacement: "check the company facts" },
  { pattern: /\bworkspace_file_read\b/gi, replacement: "read a workspace file" },
  { pattern: /\barchive_memory\b/gi, replacement: "archive a memory note" },
  { pattern: /\bmark_memory_superseded\b/gi, replacement: "mark a note superseded" },
  { pattern: /\bplan_create\b/gi, replacement: "create a plan" },
  { pattern: /\bplan_update\b/gi, replacement: "update the plan" },
  { pattern: /\bplan_get\b/gi, replacement: "read the plan" },
  { pattern: /\bweb_search\b/gi, replacement: "search the web" },
  { pattern: /\bcomposio\b/gi, replacement: "the integration" },
  { pattern: /\btool_call\b/g, replacement: "command" },
  // HOTFIX 24 (2026-05-17, R-MARTI-1 v3 walk): reasoning chip leaked
  // named users + internal rule names directly into Marti reply ("Pedro"
  // 3x + "shared memory" + "FLEX MODE" in the live Reasoning surface).
  // Strip the operator's personal name + normalise developer protocol
  // names to plain phrasing the operator can read.
  { pattern: /\bPedro\b/g, replacement: "the operator" },
  { pattern: /\bshared memory\b/gi, replacement: "an internal rule" },
  { pattern: /\bFLEX MODE\b/gi, replacement: "the priority rule" },
  { pattern: /\bsystem_prompt\b/g, replacement: "behavior settings" },
  { pattern: /\btype mismatch\b/gi, replacement: "format issue" },
  { pattern: /\bcommand structure\b/gi, replacement: "request format" },
  // HOTFIX 15 (2026-05-17, R-BELL walk): persisted Coordination-check
  // notifications from before HOTFIX 8c shipped still carry raw
  // infra error strings. Rewrite the worst offender so the bell
  // dropdown renders the same humanized copy regardless of message age.
  {
    pattern:
      /Claude Max quota exhausted - all OAuth tokens cooling down\.\s*Operator should add more accounts to \/connections\./gi,
    replacement:
      "Hit our run limit for the moment - retrying shortly. If this keeps happening, add another account at /connections.",
  },
  {
    pattern: /\bClaude Max quota exhausted\b/gi,
    replacement: "hit our run limit",
  },
  {
    pattern: /\ball OAuth tokens cooling down\b/gi,
    replacement: "retrying shortly",
  },
  // HOTFIX 15 prime (2026-05-17, R-BELL findings + B 17:36 ACK):
  // additional infra-jargon strings persisted in
  // rgaios_agent_chat_messages / notification surfaces.
  {
    pattern:
      /Anthropic call failed:\s*The operation was aborted due to timeout/gi,
    replacement: "External AI call timed out - retrying.",
  },
  {
    pattern: /\bAnthropic call failed\b/gi,
    replacement: "external AI call failed",
  },
  {
    pattern: /\bOAuth tokens?\b/gi,
    replacement: "credentials",
  },
];

export function humanizeJargon(raw: string): string {
  if (!raw) return raw;
  let out = raw;
  for (const { pattern, replacement } of JARGON_MAP) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
