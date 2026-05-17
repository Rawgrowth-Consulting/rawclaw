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
  { pattern: /\bshared memory\b/gi, replacement: "shared notes" },
  { pattern: /\bFLEX MODE\b/gi, replacement: "the priority rule" },
  { pattern: /\bsystem_prompt\b/g, replacement: "behavior settings" },
  { pattern: /\btype mismatch\b/gi, replacement: "format issue" },
  { pattern: /\bcommand structure\b/gi, replacement: "request format" },
  // HOTFIX 26 (2026-05-17, R-MARTI-CANONICAL v3 review by B 01:30):
  // "the operator" replacement from H24 was awkward in reasoning grammar
  // ("the an internal rule"); revert to direct phrasing. Operator-name
  // strip moves to thinking.ts at write time. Also collapse "command"
  // jargon in reasoning narrative to "request" / "task" so the spinner
  // copy reads natural.
  { pattern: /\bOperator wants\b/g, replacement: "User asks" },
  { pattern: /\bThe operator wants\b/g, replacement: "User asks" },
  { pattern: /\bthe operator\b/g, replacement: "the user" },
  { pattern: /\bOperator\b/g, replacement: "User" },
  { pattern: /\boperator\b/g, replacement: "user" },
  { pattern: /\bcommand type\b/gi, replacement: "request format" },
  { pattern: /\bcommand was wrong\b/gi, replacement: "request was malformed" },
  { pattern: /\berrored on command\b/gi, replacement: "errored on request" },
  { pattern: /\bWorking on command\b/gi, replacement: "Working on it" },
  // HOTFIX 27 (2026-05-17, R-MARTI-CANONICAL v4 review B 01:39):
  // operator-name strip + remaining narrative jargon.
  { pattern: /\bPedro(?:'s)?\b/g, replacement: "" },
  { pattern: /\bwrong tool name\b/gi, replacement: "wrong action name" },
  { pattern: /\bcanonical args\b/gi, replacement: "canonical inputs" },
  { pattern: /\btool name\b/gi, replacement: "action name" },
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
  // HOTFIX H-ARCH-1 (2026-05-17, B 02:04 root-cause review of v6 walk):
  // operator-visible reply leaked filenames + internal storage refs +
  // raw "tool errored" / "Tool failed" jargon. Stop the bleed at the
  // jargon layer (negative preamble rules now block emission upstream;
  // this is the safety net for any phrase that still slips through).
  { pattern: /\bThe scrape tool errored\b/gi, replacement: "The scrape action failed" },
  { pattern: /\bscrape tool errored\b/gi, replacement: "scrape action failed" },
  { pattern: /\btool errored\b/gi, replacement: "action failed" },
  { pattern: /\bTool failed\b/g, replacement: "Action failed" },
  { pattern: /\btool failed\b/g, replacement: "action failed" },
  { pattern: /\bPer an internal rule\b/gi, replacement: "Per setup" },
  { pattern: /\bper an internal rule\b/gi, replacement: "per setup" },
  { pattern: /\bshared notes\b/gi, replacement: "shared notes" },
  { pattern: /\b(scan_agent\.yaml|scan__CLAUDE\.md|CLAUDE\.md|scan__agent\.yaml)\b/g, replacement: "internal config" },
  { pattern: /\bKasia(?:'s)? (?:tasks|files|folder|data|memory|notes|content|stuff|knowledge|side|space|workspace)\b/g, replacement: "Kasia" },
  { pattern: /\b(Atlas|Scan|Zosia|Marti|Anya|Marta)(?:'s)? (?:files|folder|data|tasks|memory|notes|content|stuff|knowledge|side|space|workspace)\b/g, replacement: "$1" },
  // H-ARCH-2g (v10 02:47 review): peer pronoun + storage suffix
  // ("her tasks", "his folder", "their files") still slips when the
  // model uses a pronoun instead of the agent's name. Strip the
  // storage suffix entirely - operator never wants the routing.
  { pattern: /\b(her|his|their) (?:tasks|files|folder|data|memory|notes|content|stuff|knowledge|side|space|workspace)\b/g, replacement: "their notes" },
  // H-ARCH-5 (B 03:26 spec): delegation card "Task: ..." body
  // still leaks raw tool names + arg kvs ("apify_top_reels_from_file
  // window_days=10 top_n=10 metric=comments"). Strip those + the
  // arg-shape preamble. Also soften retry-rate messages to remove
  // /connections + "add another account" leaks.
  { pattern: /\brace_scrape\b/gi, replacement: "additional scrape" },
  { pattern: /\bcoverage_brief\b/gi, replacement: "coverage summary" },
  { pattern: /\bwindow_days=\d+\b/gi, replacement: "" },
  { pattern: /\btop_n=\d+\b/gi, replacement: "" },
  { pattern: /\bmetric=comments\b/gi, replacement: "by comments" },
  { pattern: /\bmetric=likes\b/gi, replacement: "by likes" },
  { pattern: /\bmetric=views\b/gi, replacement: "by views" },
  { pattern: /\bArgs:\s*/g, replacement: "" },
  { pattern: /\bname-RESOLVE\b/gi, replacement: "the resolution rule" },
  { pattern: /\bFILENAME-RESOLVE\b/gi, replacement: "the resolution rule" },
  { pattern: /\brun limit\b/gi, replacement: "brief pause" },
  { pattern: /\s*(?:at\s+)?\/connections\b\.?/gi, replacement: "" },
  { pattern: /\badd another account\b/gi, replacement: "contact support" },
  { pattern: /\bif this keeps happening, contact support\b/gi, replacement: "ping me if it keeps happening" },
  // H-ARCH-5e (v24 review): generic .md/.yaml/.csv/.json/.xml/.txt
  // filename extension leak. Strip the bare filename in operator
  // reply ("creator-list-v2.md" -> "creator list", "report.csv" ->
  // "report"). Also catch apify API field names that bleed through.
  { pattern: /\b([a-z0-9][a-z0-9_-]*)(?:[-_](?:v\d+))?\.(?:md|csv|json|ya?ml|xml|txt|tsv|jsonl)\b/gi, replacement: (_m, base: string) => base.replace(/[-_]/g, " ") },
  { pattern: /\bcommentsCount\b/g, replacement: "comments count" },
  { pattern: /\bfile_name\s*=\s*"?[^"\s,]*"?/gi, replacement: "" },
  { pattern: /\bfile_name\b/gi, replacement: "the file" },
  { pattern: /\blikeCount\b/g, replacement: "likes" },
  { pattern: /\bplayCount\b/g, replacement: "plays" },
  { pattern: /\bviewCount\b/g, replacement: "views" },
  // H-ARCH-2b (B 02:17 spec extras): residual "tool" + "filename"
  // word leaks in v7 reply body.
  { pattern: /\bfile-based tool\b/gi, replacement: "file-based scrape" },
  // H-ARCH-2f (C 02:37 BUG P1): article-stripped "actual file names"
  // → "my files" created double-article ("my my files", "the my
  // files"). Anchor on the preceding article and replace whole span.
  { pattern: /\b(my|the|your|our|its) actual file names?\b/gi, replacement: "$1 file list" },
  { pattern: /\bactual file names?\b/gi, replacement: "the file list" },
  { pattern: /\bthe right filename\b/gi, replacement: "the right one" },
  { pattern: /\bright filename\b/gi, replacement: "right one" },
  // H-ARCH-2c (v8 02:26 review): singular "filename" + variants
  // still surfaced ("the actual filename", "the exact filename",
  // "the correct name", "the file name"). Strip the storage word.
  { pattern: /\bthe actual filename\b/gi, replacement: "my files" },
  { pattern: /\bthe exact filename\b/gi, replacement: "the name" },
  { pattern: /\bthe correct filename\b/gi, replacement: "the name" },
  { pattern: /\bthe correct name\b/gi, replacement: "the name" },
  { pattern: /\b(?:exact|actual|correct) filename\b/gi, replacement: "name" },
  { pattern: /\bfilename\b/gi, replacement: "name" },
  // H-ARCH-2d (B 02:28 v8 review): "lookup" / "fetch" still
  // read as infra jargon to non-dev operators.
  { pattern: /\bfile lookup failed\b/gi, replacement: "file search came up empty" },
  { pattern: /\bfile fetch missed\b/gi, replacement: "file search came up empty" },
  { pattern: /\bfile lookup\b/gi, replacement: "file search" },
  { pattern: /\bfile fetch\b/gi, replacement: "file search" },
  { pattern: /\battached file name\b/gi, replacement: "attached file" },
  // H-ARCH-2e (v9 02:37 review): bare "<verb> tool" still leaks
  // when the noun isn't "failed"/"errored" (e.g. "the scrape tool
  // needs", "the scrape tool returned"). Strip the suffix in safe
  // verb contexts.
  { pattern: /\bscrape tool needs\b/gi, replacement: "scrape needs" },
  { pattern: /\bscrape tool returned\b/gi, replacement: "scrape returned" },
  { pattern: /\bscrape tool can(?:not|'t)\b/gi, replacement: "scrape can't" },
  { pattern: /\bthe scrape tool\b/gi, replacement: "the scrape" },
  { pattern: /\bare internal config\b/gi, replacement: "are internal" },
  // H-ARCH-2 (v7 review 02:17): when multiple internal filenames are
  // listed in a single sentence and all map to "internal config", the
  // resulting "internal config, internal config, internal config" reads
  // like noise. Collapse consecutive repeats into a single phrase.
  { pattern: /(\binternal config\b)(?:,\s*internal config\b)+/g, replacement: "$1" },
];

export function humanizeJargon(raw: string): string {
  if (!raw) return raw;
  let out = raw;
  for (const { pattern, replacement } of JARGON_MAP) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
