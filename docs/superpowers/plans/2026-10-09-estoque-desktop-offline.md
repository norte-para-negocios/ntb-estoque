# Norte Estoque desktop offline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App Windows (Electron) do Norte Estoque com cópia local do sistema (Next + PostgREST + Postgres + frio-api) que funciona sem internet e sincroniza com a produção.

**Architecture:** Servidor ganha um "canal desktop" (`/api/offline/*`, log compactado de mudanças, idempotência, registro de ações). Desktop roda o mesmo código Next em modo local; leituras vão ao banco local sincronizado por pull; escritas vão ao servidor via o canal (com internet) ou à fila (sem internet), com ids provisórios remapeados no reenvio.

**Tech Stack:** Next 16 (standalone), Electron 33, embedded-postgres 17.10.0-beta.17, PostgREST v12.2.12, pg 8, node:test.

**Spec:** `docs/superpowers/specs/2026-10-09-estoque-desktop-offline-design.md`

## Global Constraints

- Produção não pode mudar de comportamento: toda mudança no caminho do servidor é inerte sem `NTB_MODO_LOCAL=1` (desktop) ou sem headers `x-ntb-desktop` (canal).
- Segredos nunca saem do servidor: allowlist de tabelas/colunas em SQL (`offline_tabelas`), denylist de colunas de `lojas` (`omie_app_key, omie_app_secret, certificado_path, certificado_nome, certificado_senha_enc, certificado_validade, certificado_atualizado, csc_producao, csc_id_producao, integracao_api_key, integracao_teste_api_key, codigo_onboarding`).
- Tudo do desktop escuta só em `127.0.0.1`; portas: gateway 54398, next 54397, postgrest 54396, frio 54395, postgres 54394.
- Ids provisórios: int4 = 2.000.000.000 + i×1.000.000; int8 = 9.000.000.000.000.000 + i×1.000.000.000 (i = índice da tabela em `offline_tabelas` ordenado por nome).
- Migrations aplicadas à mão (`docker exec -i supabase-db psql -v ON_ERROR_STOP=1 ...`), deploy manual (`deploy.sh`).
- Pure files sem alias `@/` e sem import `.ts` (tsc TS5097); testes `node --test lib/offline/*.test.ts`.
- Mensagens ao usuário em português, curtas.

## Review Focus

1. Usuário de uma loja recebendo linha de outra loja (snapshot, pull, linhas, frio) ou coluna proibida de `lojas`.
2. Reenvio duplicado da mesma ação (rede cai depois do servidor executar) gerando ajuste em dobro no Omie.
3. Commit fora de ordem na outbox fazendo o pull pular uma mudança.
4. Ação offline que depende de linha criada offline sendo enviada com id provisório não remapeado.
5. Página/endpoint do gateway acessível por outro site no navegador (CSRF/DNS rebinding) ou token real vazando para o processo Next/webview.

---

### Task 1: Harness local (Postgres embutido + esquema da produção)

**Files:**
- Create: `desktop/package.json`, `desktop/scripts/gerar-schema.sh`, `desktop/schema/estoque.sql`, `desktop/schema/frio.sql`, `desktop/schema/base.sql`, `desktop/schema/local.sql`, `desktop/electron/banco.js`, `desktop/scripts/testar-banco.mjs`

**Interfaces:**
- Produces: `banco.iniciar({ dataDir, porta, senhaAdmin, senhaAuthenticator, jwtSecretLocal }) → { pg, parar() }` (initdb na 1ª vez, aplica base/estoque/frio/local, grava hash do esquema em `ntb_local.meta`); `banco.hashEsquema()`.

- [ ] `gerar-schema.sh`: `pg_dump --schema-only --no-owner --no-privileges -n public` do `supabase-db` e do `ntb_frio` via ssh; pós-processa (remove `outbox_trigger`, `CREATE PUBLICATION`, `COMMENT ON EXTENSION`, extensões fora de uuid-ossp/pgcrypto/pg_trgm).
- [ ] `base.sql`: papéis `anon`, `authenticated`, `service_role BYPASSRLS`, `authenticator NOINHERIT LOGIN` com grant dos 3; schema `auth` com `uid()`, `role()`, `jwt()` (cópia do Supabase); schema `extensions` + 3 extensões; `alter default privileges` e grants padrão do Supabase no `public`.
- [ ] `local.sql`: `ntb_local.meta(chave,valor)`, `ntb_local.alteracoes(seq bigserial, tabela, pk jsonb, op, intent_id text, em)`, função `ntb_local.rastrear()` (ignora quando `current_setting('ntb.aplicando', true) = '1'`; lê `x-ntb-intent` de `request.headers`), aplicada por `ntb_local.instalar_rastreio(tabelas text[])`; `ntb_local.ajustar_sequencias(base jsonb)`.
- [ ] `testar-banco.mjs`: sobe o banco num tmp, confere que as 3 extensões existem, que `relatorio_movimentacao_matriz` existe, que `set role authenticated` + claims lê `auth.uid()`, e derruba.
- [ ] Run: `node desktop/scripts/testar-banco.mjs` → Expected: `OK banco local`.
- [ ] Commit.

### Task 2: Libs puras do canal offline

**Files:**
- Create: `lib/offline/politica.ts`, `lib/offline/serializacao.ts`, `lib/offline/ids-provisorios.ts`, `lib/offline/pareamento.ts` + `.test.ts` de cada.

**Interfaces:**
- `politica.ts`: `type ModoOffline = 'leitura'|'local'|'fila'`; `POLITICA: Record<string, {modo: ModoOffline}>`; `politicaDe(nome): ModoOffline | null`.
- `serializacao.ts`: `serializarArgs(args: unknown[]): Promise<Json>` (FormData → `{__fd:[[k, v|{__arq:{nome,tipo,b64}}]]}`, Date → `{__data}`), `desserializarArgs(json): unknown[]`, `lerDigest(err): {tipo:'redirect', url, status} | {tipo:'notfound'} | null`.
- `ids-provisorios.ts`: `faixaDe(indice, tipo:'int4'|'int8'): number`, `ehProvisorio(n): boolean`, `tabelaDoProvisorio(n, tabelas: string[]) → string|null`, `reescreverIds(json, mapa: Map<number,number>): {json, faltando: number[]}` (números e segmentos numéricos de strings tipo URL).
- `pareamento.ts`: `parear(locais: {tabela,pk}[], remotos: {tabela,pk}[]): {mapa: Map<number,number>, divergentes: string[]}` (por tabela, na ordem; contagem diferente = tabela divergente).
- [ ] Testes primeiro (casos: FormData com arquivo, redirect digest `NEXT_REDIRECT;replace;/x;307;`, provisório int4/int8, reescrita em `'/inventario/2000000005'`, pareamento com contagem divergente).
- [ ] Run: `node --test lib/offline/*.test.ts` → FAIL, implementa, PASS.
- [ ] Commit.

### Task 3: SQL do canal no servidor (migration 157)

**Files:**
- Create: `supabase/migrations/157_canal_offline.sql`, `scripts/testar-canal-offline.sql`

**Interfaces (Produces):**
- `offline_tabelas(tabela pk, pk_cols text[], loja_col text, pai_tabela, pai_fk, pai_pk, colunas_ocultas text[], indice int)`; `offline_versoes(tabela, pk jsonb, loja_id int, versao bigint, apagado bool, outbox_id bigint, primary key(tabela, pk))` + índice em `versao`; `offline_meta(chave, valor)` (`ultimo_outbox`, `piso_versao`).
- `outbox.intent_id text` + `outbox_capture()` preenchendo de `request.headers->>'x-ntb-intent'`; `outbox_trigger` nas tabelas permitidas que não têm.
- `offline_compactar() returns int` (advisory lock; janela de 50.000 ids antes do último; upsert só se `outbox_id` maior).
- `offline_puxar(p_lojas int[], p_cursor bigint, p_limite int) returns table(versao, tabela, apagado, dado jsonb)`.
- `offline_snapshot(p_tabela text, p_lojas int[], p_depois jsonb, p_limite int) returns table(pk jsonb, dado jsonb)` (keyset por pk).
- `offline_linhas(p_lojas int[], p_itens jsonb) returns table(tabela, pk, dado)`.
- `offline_criados(p_intent text) returns table(tabela, pk, outbox_id)`.
- `offline_execucoes(intent_id text pk, user_id uuid, acao text, status text, resultado jsonb, criado_em, atualizado_em)`.
- `offline_podar()` (lápides > 60 dias; atualiza `piso_versao`).
- Todas `security definer` com `revoke execute ... from public, anon, authenticated` (só `service_role`).
- [ ] Teste SQL contra o banco do harness da Task 1 (carregado com o esquema de produção): 2 lojas, linha nova → compactar → puxar só da loja certa; coluna oculta ausente; commit fora de ordem (outbox id menor inserido depois) aparece na compactação seguinte; reprocessar não cria versão nova.
- [ ] Run: `node desktop/scripts/testar-canal.mjs` → PASS.
- [ ] Commit.

### Task 4: Rotas do canal no servidor + sessão via header

**Files:**
- Create: `app/api/offline/sessao/route.ts`, `app/api/offline/snapshot/route.ts`, `app/api/offline/mudancas/route.ts`, `app/api/offline/linhas/route.ts`, `app/api/offline/frio/route.ts`, `app/api/offline/acao/route.ts`, `lib/offline/canal.ts` (auth do canal, lojas do usuário, gzip NDJSON, rate limit), `lib/offline/contexto.ts` (AsyncLocalStorage do intent), `lib/offline/registro-acoes.ts`
- Modify: `proxy.ts` (Bearer + `x-ntb-refresh` + `x-ntb-desktop` → cookies via `setSession`; `/api/offline` público), `lib/supabase/server.ts` (header `x-ntb-intent` quando há intent no contexto)
- Modify (servidor, fora do repo): `/opt/ntb-frio-api/server.js` ganha `GET /export?tabela&loja_id&depois&limite` (backup antes)

**Interfaces:**
- `canal.ts`: `autenticarCanal(req) → {userId, lojas:number[], admin:boolean} | Response`; `OFFLINE_VERSAO_MINIMA = '1.0.0'`.
- `acao` body: `{intentId, acao: 'modulo#funcao', args: Json, versaoApp}` → `{ok:true, valor, redirect?, criados:[{tabela,pk}]}` | `{ok:false, erro, tipo:'negocio'|'versao'|'em_andamento'}`.
- [ ] Teste: `scripts/qa-canal-offline.mjs` (conta QA): sessão entrar → snapshot de `familias` só lojas do QA → mudanças → `acao` de leitura (`produtos-search#buscarProdutos`) com mesmo intent 2× devolve o mesmo resultado gravado.
- [ ] Commit.

### Task 5: `viaDesktop` + uma linha em cada uma das 156 ações

**Files:**
- Create: `lib/offline/via-desktop.ts`, `scripts/inserir-via-desktop.mjs`
- Modify: `lib/actions/*.ts` (40 arquivos)

**Interfaces:**
- `viaDesktop(nome: string, fn: (...a: any[]) => Promise<unknown>, args: IArguments): Promise<never> | undefined`. Fora do desktop: `undefined` imediato.
- No desktop: `leitura` → undefined; senão POST `http://127.0.0.1:54398/__ntb/acao` com `x-ntb-token` (env `NTB_GATEWAY_TOKEN`) e `{acao, args, modo}` → `remoto` (valor/redirect + `revalidatePath('/', 'layout')`), `executar_local` (roda `fn` dentro do contexto do intent e reporta `/__ntb/resultado-local`), `enfileirado` (devolve `{}`), `erro` (devolve `{ error }`).
- [ ] Script insere `const __d = viaDesktop('<arquivo>#<fn>', <fn>, arguments); if (__d) return __d as never` como 1ª linha de cada `export async function` de arquivo `'use server'`, idempotente.
- [ ] Run: `npx tsc --noEmit` → limpo; `npm run lint` → sem erro novo; `node --test lib/*.test.ts lib/offline/*.test.ts` → PASS.
- [ ] Commit; aplicar migration 157, crontab de `offline_compactar()` a cada minuto e `offline_podar()` diário, frio `/export`, deploy, rodar `qa-canal-offline.mjs` em produção.

### Task 6: Processo principal do desktop (gateway, auth shim, cofre)

**Files:**
- Create: `desktop/electron/main.js`, `desktop/electron/cofre.js` (safeStorage + JSON em userData), `desktop/electron/gateway.js`, `desktop/electron/auth-local.js` (JWT HS256, scrypt), `desktop/electron/processos.js` (spawn postgrest/next/frio com `ELECTRON_RUN_AS_NODE`), `desktop/electron/remoto.js` (cliente do canal com renovação de token), `desktop/electron/preload.js`, `desktop/vendor/` (download por script com sha256)
- Create: `desktop/scripts/baixar-binarios.mjs`

**Interfaces:**
- Gateway: confere `Host` = `127.0.0.1:54398`; `/rest/v1/*` → PostgREST (troca `apikey`/Bearer anon de build pelo JWT anon local; Bearer de usuário só se assinado pelo segredo local); `/auth/v1/token?grant_type=password|refresh_token`, `/auth/v1/user`, `/auth/v1/logout`; `/__ntb/acao|resultado-local` (exige `x-ntb-token`), `/__ntb/status` (GET), `/__ntb/fila` (GET) e `/__ntb/fila/descartar` (POST, exige `X-NTB` e Origin local); rotas só-online (`/api/nota-fiscal/`) → remoto com o token do usuário; resto → Next.
- [ ] Teste: `desktop/scripts/testar-gateway.mjs` (sem Electron: injeta cofre em memória) → Host errado = 421; `/__ntb/acao` sem token = 403; token anon de build trocado; JWT forjado com outro segredo = 401.
- [ ] Commit.

### Task 7: Motor de sincronização

**Files:**
- Create: `desktop/electron/sync.js` (snapshot, pull 20 s, frio 15 min, fila, reenvio, mapa de ids, reconciliação), `desktop/electron/fila.js` (fila em arquivo JSON atômico no userData)

**Interfaces:**
- `sync.primeiraCarga(progresso)`, `sync.loop()`, `sync.executarAcao({acao,args,modo}) → {tipo, ...}`, `sync.status() → {online, pendentes, erros, ultimaSync, carga}`.
- Regras: upsert local com `set session_replication_role = replica` e `set ntb.aplicando = '1'`, só colunas locais; cursor gravado antes do snapshot; cursor < piso = refaz snapshot; fila FIFO, intent com id provisório sem mapa = erro "depende de operação que falhou"; erro de rede = tenta de novo (5 s → 5 min); `em_andamento` = "verificar manualmente".
- [ ] Teste: `desktop/scripts/testar-sync.mjs` contra produção com conta QA numa loja de teste: carga inicial de `familias`/`produtos`, pull aplica mudança, fila offline com mapa provisório (usa ação `meta-mensal#salvarMetaMensal`, que não cria id → caminho simples).
- [ ] Commit.

### Task 8: Build desktop do Next + telas do desktop + empacotamento

**Files:**
- Modify: `next.config.ts` (`NTB_DESKTOP=1` → `output:'standalone'`, `distDir:'.next-desktop'`)
- Create: `components/desktop/BannerSync.tsx` (só com `NEXT_PUBLIC_DESKTOP=1`), `app/(app)/sincronizacao/page.tsx`, `desktop/carga.html` (tela de primeira carga servida pelo gateway), `desktop/scripts/build.sh`, `desktop/scripts/publish.sh`
- Modify: `app/(app)/layout.tsx` (banner)

- [ ] `build.sh`: build do Next desktop, copia standalone+static+public, baixa binários Windows, `electron-builder --win --x64`.
- [ ] Teste ponta a ponta no Mac (`npm run dev` do desktop com binários darwin): login QA → carga → relatórios abrem iguais ao site → desligar rede (gateway em modo forçado offline) → ação local → fila → religar → reenvio e ids reais.
- [ ] Gerar instalador Windows, publicar no feed `ntb-estoque-desktop`, documentar no AGENTS.md.
- [ ] Commit.
