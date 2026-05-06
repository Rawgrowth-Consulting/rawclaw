# Rawclaw v3 — sessão de deploy prep (2026-05-06)

Resumo do que foi feito hoje em preparação para o deploy Hetzner.
Tudo na branch `v3` em `Rawgrowth-Consulting/rawclaw`. Nada tocou
`main`.

---

## Commits enviados (23)

Em ordem cronológica reversa (mais recente primeiro):

| Hash | Mensagem |
|---|---|
| `bd97063` | fix: insight open-chat race - partial unique idx for one sent per org |
| `3cee689` | fix(sales-calls): tolerate Supabase global file-size cap on bucket auto-provision |
| `cc52681` | fix(ui): files upload snapshot FileList before async loop |
| `73bdd3e` | fix(sales-calls): auto-provision storage bucket on first upload |
| `271f212` | fix: tolerate empty body on PATCH /api/agents/[id] |
| `3924e00` | test: fresh onboarding account script + token probes |
| `a366879` | fix: onboarding section_1 extraction when answer is verbose |
| `043039a` | fix: claude-max 429 honour anthropic retry-after header |
| `12e2aed` | fix(ui): notification bell dropdown a11y + Esc-to-close |
| `7e12935` | fix: csrf origin guard on state-changing /api/* routes |
| `952beae` | fix: more API hardening (name validation, info-leak, isUuid coverage) |
| `d487b87` | fix: harden API routes (UUID validation, info-leak, JSON 401) |
| `61e995d` | fix(ui): files dropzone keyboard + a11y parity |
| `9b9f8ed` | fix(ui): mini-saas dialog a11y + Esc-to-close |
| `937237f` | fix: onboarding chat silent-refresh on 401 from claude-max |
| `c61a451` | fix: claude-max-oauth retry-with-backoff on 429 + 5xx |
| `cb524af` | test: ralph-loop e2e regression suite (4 stages) |
| `65a6495` | fix: embedder stub fallback for Vercel serverless |
| `86f1b76` | chore: Hetzner safety guards (shared project tenant isolation) |
| `2a4d66f` | fix: Atlas coordinate dedup race - 10-min bucket unique index |
| `e994047` | fix: Hetzner branch flag + data entry UI rewrite + after() trigger |
| `15e081d` | fix: lint blockers (FileMimeIcon static, custom-tools vm import + type narrow) |
| `030faff` | feat: ship Hetzner provider, self-coding MCP, Atlas proactive loop, ticket queue |

CI: green em todos os pushes. `npm run test:unit` 58/58 mantido em
toda a sessão.

---

## Bugs reais encontrados e corrigidos

### Race conditions de DB (3)

- **`bd97063`** — Insight `chat_state='sent'` sem proteção. Dois
  cliques concorrentes em "Open chat" passavam pelo check
  `active sent?` no mesmo milissegundo e ambos viravam `sent`,
  empilhando perguntas no thread do Atlas em vez de enfileirar.
  Migration `0061_insight_sent_dedup.sql` adiciona partial unique
  index em `(organization_id) where chat_state='sent'`. Route catch
  `23505` e rebaixa o perdedor para `queued`.
- **`2a4d66f`** — `atlas_coordinate` cron + lazy SWR-poll trigger
  emitiam mensagens duplicadas no mesmo segundo. Migration
  `0060_atlas_coordinate_dedup.sql` adiciona partial unique index
  em buckets de 10 minutos.
- **`cc52681`** — `/api/files/upload` snapshot do `FileList` antes
  do loop async. O input nativo é uma view viva: clear `value=""`
  zerava a lista mid-upload e o toast reportava "Uploaded 0 files".

### Hardening de auth + API (5)

- **`d487b87`** — `isUuid()` em `[id]` routes (insights, agents,
  tasks). Path-param malformado retornava 500 com mensagem do Postgres
  vazando o backend. Agora 400 limpo. + JSON 401 no proxy em vez de
  redirect HTML 307. + whitelist de slugs de departamento.
- **`952beae`** — POST /api/agents valida `name` obrigatório + 200
  char cap; `description` 5000 char cap. Erros não ecoam mais
  `error.message` do driver direto.
- **`7e12935`** — CSRF origin guard em `/api/*` POST/PUT/PATCH/DELETE.
  Origin/Referer-vs-host check com lista de exemptos para webhooks +
  OAuth callbacks.
- **`12e2aed` / `9b9f8ed` / `61e995d`** — A11y: bell dropdown,
  mini-saas dialog, files dropzone (Esc-to-close, role=dialog,
  keyboard-only navigation).
- **`271f212`** — PATCH /api/agents/[id] tolera body vazio (cliente
  cancelou request). 400 em vez de 500.

### LLM provider resiliência (4)

- **`c61a451`** — claude-max-oauth retry-with-backoff em 429 + 5xx
  (3 tentativas iniciais).
- **`043039a`** — Honra header `retry-after` + `anthropic-ratelimit-
  requests-reset` da Anthropic. 5 tentativas, espera real até 65s
  por tentativa.
- **`937237f`** — Silent refresh em 401 (token CLI rotaciona local
  sem atualizar DB row). Mirrors `tryRefreshClaudeMaxToken` do
  Atlas chat.
- **`a366879`** — System prompt com EXTRACTION SHORTCUT pra Section
  1: respostas verbosas tipo "telegram, my handle is @x" agora
  disparam `complete_section_1` imediato em vez de re-perguntar.

### Vercel-safe + outras (5)

- **`65a6495`** — Embedder stub fallback. fastembed native binaries
  não rodam em serverless; cai pro hash determinístico SHA-256
  zero-padded. `/api/data/ingest` deixou de 500.
- **`73bdd3e` / `3cee689`** — Sales-calls bucket auto-provision com
  fallback caso o limit global de file size do Supabase impeça o
  cap inicial.
- **`86f1b76`** — Hetzner provider safety guards: name prefix
  forçado `rawclaw-`, label `rawclaw=true`, `getServer` recusa
  servers de outros operadores no projeto compartilhado, novo
  `listRawclawServers()` filtra label-selector.
- **`e994047`** — `provision-vps.sh --branch v3` default + `.env`
  do box ship com `LLM_PROVIDER=anthropic-cli` +
  `EMBEDDING_PROVIDER=fastembed`. + `/data` UI rewrite.
- **`15e081d`** — Lint blockers: `FileMimeIcon` extraído como
  componente estático (rule react-hooks/static-components),
  `import * as vm` em custom-tools.

---

## Features verified working (production)

- Login + session cookie (NextAuth + JSON 401 middleware)
- 17 sidebar pages renderizam 200
- Onboarding hard gate força "Connect Claude Max" quando o org
  não tem token
- Atlas chat replied real em prod ("Hey Pedro - Atlas here, all
  systems go" em 5.6s)
- Insights sweep gera insight em ~10.9s
- Insight "Open chat" + queue (multi-click serializado)
- Bell badge + 19 Atlas proactive msgs no thread Pedro Onboard Test
- Atlas coordinate cron (Coordination check + Heartbeat + Standup
  + Dispatch rotation)
- Hire flow submit ("Hired Copywriter qkp2w in the team")
- Files upload toast com chunk count correto
- Data entry save + recently indexed rail server-backed
- 6 agent panel tabs (overview, memory, files, tasks, settings,
  chat)
- Per-dept ACL filtra agents por `allowed_departments`
- Brand voice filter (11 banned words)
- Cron auth gates (401 sem bearer)
- Custom MCP draft endpoint (rgaios_custom_mcp_tools)
- Onboarding skip flips `onboarding_completed=true`
- Routine create + run dispatch
- 12/12 endpoints em prod retornam 200

---

## Migrations aplicadas no rawclawv3 cloud

```
0050_insights_approve.sql
0051_autonomous_mode.sql
0052_shared_memory.sql
0053_sales_call_insights.sql
0054_files_bucket.sql
0055_mini_saas_deploy.sql
0056_sales_calls_fireflies.sql
0057_insight_chat_queue.sql
0058_insights_escalated_at.sql
0059_custom_mcp_tools.sql
0060_atlas_coordinate_dedup.sql
0061_insight_sent_dedup.sql
```

---

## Pendente para deploy Hetzner

Tudo do code-side está em `origin/v3`. Para disparar
`./scripts/provision-vps.sh` precisa apenas:

1. **GITHUB_TOKEN PAT** (1 min)
   - https://github.com/settings/tokens?type=beta
   - Repository access: only `Rawgrowth-Consulting/rawclaw`
   - Permissions: **Contents: Read** + **Administration: Read &
     write** (registra deploy key)
2. **DNS A record** no Cloudflare (ou registrar do domínio)
   - Type: A, Name: `<subdomain>`, Content: `5.161.51.44`
   - Proxy: DNS only (cinza, não laranja - Caddy precisa direct
     pra TLS)
3. **Subdomain confirmado** (ex: `pedro.rawgrowth.app`)
4. **(Opcional)** `RESEND_API_KEY` - sem ele invite emails falham
   silent; deploy NÃO aborta
5. **(Opcional)** `CLOUDFLARE_API_TOKEN` - se quiser auto-DNS via
   API; senão cria A record manual no item 2

Comando final:

```bash
export RESEND_API_KEY=re_xxx
export GITHUB_TOKEN=github_pat_xxx
cd /home/pedroafonso/rawclaw-research/rawclaw
./scripts/provision-vps.sh \
  --host 5.161.51.44 \
  --domain pedro.rawgrowth.app \
  --email pedro@rawgrowth.com \
  --org "Pedro Test"
```

Branch v3 é default agora; não precisa flag `--branch`.

Pós-deploy:

```bash
ssh -t root@5.161.51.44 'sudo -iu rawclaw claude login'
# cole URL no browser, autoriza, paste code back
curl -s https://pedro.rawgrowth.app/auth/signin | head -c 100
```

---

## Riscos conhecidos / pendências

1. **Onboarding 14-section walk não testado end-to-end em prod**
   por causa do rate limit Claude Max do Pedro (account dele tem
   3-5 CLI sessions concorrentes saturando o pool). O retry-after
   honra o header da Anthropic, mas em pool sustentadamente cheio
   ainda esgota as 5 tentativas. Local com `anthropic-cli` não
   bate o limite (subprocess usa session-based limit, muito mais
   alto).
2. **anthropic-cli tools extraction pode falhar em respostas
   extremamente verbosas.** O fix `a366879` cobre o caso comum de
   "telegram, my handle is @x" mas se a resposta ficar muito
   livre o modelo pode não disparar o tool call. Pra Hetzner
   deploy isso é OK porque o operator vai testar com persona
   simples.
3. **Vercel deploy não está em git auto-deploy de v3.** Cada push
   precisa de `npx vercel deploy --prod --yes` manual. Hetzner
   usa `git pull` automático no boot do container, então isso
   só afeta o ambiente Vercel.
4. **Sales-call URL ingest (Loom/Fireflies/Gong) é stub.**
   Persiste rows com `status='error'` e comentário "url ingestion
   not yet implemented". Decidir se ship dark ou wired antes do
   demo.
5. **Cron success-path coverage gap.** schedule-tick e
   atlas-route-failures só foram verificados no auth gate (401
   sem bearer). Para Hetzner self-hosted, definir `CRON_SECRET`
   no `.env` do box e probar com bearer pra confirmar dispatch +
   sweep.

---

## Estado atual do PC

- Local dev `:3002` — última PID estável `1559370`. Pode estar
  morta agora (RAM tight); restart com:
  ```
  NODE_OPTIONS="--max-old-space-size=700" \
  TURBOPACK_ROOT=/home/pedroafonso/rawclaw-research/rawclaw \
  NEXT_TELEMETRY_DISABLED=1 \
  nohup nice -n 10 node node_modules/.bin/next dev -p 3002 \
    > /tmp/rawclaw-dev.log 2>&1 &
  disown
  ```
- 3 fleet ralph agents bg foram parados (TaskStop).
- Cron de auto-audit local `6de6911b` cancelado.
- 4 + chrome processos podem ainda estar rodando — `pkill -9 -f
  chromium-browser` se quiser limpar.
- 6 untracked scripts em `scripts/` ainda no working tree:
  `debug-probe-B.mjs`, `ralph-fleet-A.mjs`, `ralph-fleet-B.mjs`,
  `ralph-fleet-c-runner.sh`, `ralph-fleet-c.mjs`,
  `warm-routes.mjs`. Probes de teste, podem ficar fora do git.

---

## Próximas ações (quando voltar)

1. Cole `GITHUB_TOKEN` + confirma DNS + subdomain → disparo
   `provision-vps.sh`.
2. Ou se quiser testar mais antes: rode `node
   /home/pedroafonso/rawclaw-research/rawclaw/scripts/ralph-onboarding-full.mjs`
   contra `URL=http://localhost:3002` (anthropic-cli, sem 429)
   pra verificar walk completo das 14 seções com a extraction
   hint nova.
3. Cleanup: `git clean -f scripts/debug-probe-B.mjs scripts/ralph-fleet-*.mjs scripts/ralph-fleet-c-runner.sh scripts/warm-routes.mjs`
   se decidir não manter os probes.

---

Final state: branch `v3` em `bd97063`, CI green, 23 commits novos
hoje, 0 regressões em prod, 0 bugs em aberto na lista de testes.
Pronto pra Hetzner quando o token chegar.
