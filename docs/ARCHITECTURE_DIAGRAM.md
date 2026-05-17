# Architecture diagram - operator-vocab humanize gateway

Visual companion to `docs/ARCHITECTURE_HUMANIZE_GATEWAY.md`.
Use this for the 30-second eye-scan; use the long-form doc for
the full spec inventory + the per-surface contract details.

Last verified: 2026-05-17 against v3 head sha `4b7b37e`
(HOTFIX H-ARCH-5f).

## Flow diagram

```mermaid
flowchart TD
    User[Operator types in chat UI]
    Model[Claude model<br/>via OAuth or Path B]
    PersistRaw[(rgaios_agent_chat_messages<br/>RAW persistence - next-turn<br/>context still resolves enums)]
    SSE[SSE emit gateway<br/>route.ts:816 / 824 / 1148 / 1270]
    HumanizeServer[humanizeJargon<br/>jargon.ts - 125 patterns]
    HumanizeClient[humanizeJargon at render<br/>AgentChatTab.tsx:1359 / 1693 / 1981]
    OperatorChat[Operator chat UI<br/>AgentChatTab.tsx]
    Bell[Notification bell<br/>notification-bell.tsx:189<br/>BellGrouped.tsx:131]
    Updates[/updates page<br/>updates/Client.tsx:478 / 670]

    User --> Model
    Model -->|raw text| PersistRaw
    Model -->|raw stream events| SSE
    SSE -->|text / thinking /<br/>command_running /<br/>commands_executed| HumanizeServer
    HumanizeServer --> OperatorChat
    PersistRaw -->|load history| HumanizeClient
    HumanizeClient --> OperatorChat
    PersistRaw --> Bell
    PersistRaw --> Updates

    subgraph Delegation [Auto-delegate without operator pick-list]
      Scan[Scan agent<br/>AI COO]
      FileResolve[FILENAME-RESOLVE rule<br/>shipped H-ARCH-4]
      Kasia[Kasia agent<br/>Marketing]
      Scan -->|file not mine| FileResolve
      FileResolve -->|single agent_invoke| Kasia
      Kasia -->|results| Scan
    end

    Scan --> Model
```

## Layer breakdown

```
+-----------------------------------------------------------+
| Layer 1 - RAW persistence                                 |
|                                                           |
|   rgaios_agent_chat_messages stores the model's verbatim  |
|   output. Tool enums, internal field names, agent IDs -   |
|   all preserved. Reason: the next turn re-builds context  |
|   from this row, and the canonical names are what makes   |
|   tool_call dispatch resolve.                             |
+-----------------------------------------------------------+
                            |
                            v
+-----------------------------------------------------------+
| Layer 2 - HUMANIZE at SSE emit boundary                   |
|                                                           |
|   route.ts emits the live SSE stream to the chat UI.      |
|   Every operator-visible string passes through            |
|   humanizeJargon() before it leaves the server:           |
|     :816   text  + thinking event scrub                   |
|     :824   tool-call summary scrub                        |
|     :1148  reasoning chip label scrub                     |
|     :1270  delegate-card detail tool scrub                |
+-----------------------------------------------------------+
                            |
                            v
+-----------------------------------------------------------+
| Layer 3 - HUMANIZE at React render boundary               |
|                                                           |
|   When a tab re-mounts and loads chat history from the    |
|   RAW table, the AgentChatTab component re-runs           |
|   humanizeJargon at render time on each message:          |
|     :1359  message.content render                         |
|     :1693  thinking text render                           |
|     :1981  delegate task body render                      |
|                                                           |
|   Same scrub also runs in:                                |
|     notification-bell.tsx:189   (bell pop-out)            |
|     BellGrouped.tsx:131         (grouped bell)            |
|     updates/Client.tsx:478,670  (/updates page)           |
|     notifications/page.tsx      (full notifications page) |
+-----------------------------------------------------------+
                            |
                            v
+-----------------------------------------------------------+
| Layer 4 - AUTO-DELEGATE via preamble rule                 |
|                                                           |
|   When Scan asks for a file owned by a peer agent (Kasia, |
|   etc), the FILENAME-RESOLVE rule (shipped H-ARCH-4) gets |
|   the model to dispatch a single agent_invoke instead of  |
|   asking the operator "which file do you mean". The       |
|   delegate card surfaces the orchestration with the       |
|   operator-meaningful prose only - all jargon scrubbed by |
|   layer 2 + layer 3.                                      |
+-----------------------------------------------------------+
```

## What this means in one sentence

The model can keep speaking its own internal language to itself
(turn-to-turn context resolves), and the operator only ever
sees the scrubbed prose - the two-layer split is what lets us
have both at once.

## Source-of-truth pairings

| Concept | File:line |
|---|---|
| RAW persistence table | `supabase/migrations/0001_*` and beyond - schema for `rgaios_agent_chat_messages` |
| JARGON_MAP (125 patterns) | `src/lib/agent/jargon.ts:18` |
| `humanizeJargon` function | `src/lib/agent/jargon.ts:221` |
| SSE emit gateway | `src/app/api/agents/[id]/chat/route.ts:816, 824, 1148, 1270` |
| Chat history render scrub | `src/components/agents/AgentChatTab.tsx:1359, 1693, 1981` |
| Notification bell scrub | `src/components/notification-bell.tsx:189` |
| Grouped bell scrub | `src/components/notifications/BellGrouped.tsx:131` |
| /updates page scrub | `src/app/updates/Client.tsx:478, 670` |
| Notifications page scrub | `src/app/notifications/page.tsx` |
| FILENAME-RESOLVE preamble | shipped in H-ARCH-4 cascade |
| Walk flagship | `screenshots/correct/test-R-MARTI-CANONICAL-v22-FLAGSHIP-100-jargon.png` (v22) and v27 post-5f (logged 2026-05-17 04:31) |

## Companion docs

- `docs/ARCHITECTURE_HUMANIZE_GATEWAY.md` - long-form spec
  inventory + per-surface contracts.
- `docs/RUNBOOK_PRODUCTION.md` - incident playbooks.
- `docs/PROVISIONING_ANTHROPIC_API_KEY.md` - Path B fallback.
- `tests/e2e/v22-flagship-replay.spec.ts` + `fixtures/v22-flagship-walk.json`
  - CI lock on the v22 flagship walk shape.
- `tests/unit/jargon*.spec.ts` - 82+ assertions across 7 spec
  files protecting the layer-2 + layer-3 scrub.
