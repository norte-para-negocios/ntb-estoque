# Fase A — Correções provadas (paridade com o Omie) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir no Norte Estoque tudo o que já tem divergência numérica provada contra o Omie (ou bug citado no código) sem mudar o desenho do app, e provar cada correção com número dos dois lados.

**Architecture:** Cada regra nova mora num módulo puro (`node --test`, sem `@/`) com o equivalente SQL numa migration numerada a partir da 175; as telas e as RPCs só passam a chamar essas regras. Itens 1–3 já estão no código (só falta aplicar e provar); itens 4 e 13 são operação; itens 5–12 são código novo, em lotes que vão a produção separados, cada um com OK do dono.

**Tech Stack:** Next.js (versão do repo: ler `node_modules/next/dist/docs/` antes de mexer em rotas), TypeScript, Supabase self-hosted (PostgREST + Postgres 17 no Contabo), supabase-js, `node:test` (Node 26), API do Omie (via `omieRequest`), SQL de teste em `scripts/testes-sql/`.

**Spec:** `docs/superpowers/plans/2026-10-18-plano-mestre-paridade-omie.md`, seção "Fase A" (itens 1–13) + evidências em `~/Projects/omie-rea/gaps/matriz-compras-estoque-producao.md` (linhas G1.1, C6, C7, G1.4, H11, L3, F12, A5, B1, J1, N5, N9, N20), `~/Projects/omie-rea/GAPS.md` (G1.1, G1.4, G2.1, G2.3, G2.4a, G2.5, G2.6, §4), `~/Projects/omie-rea/regras/entrada-nf-fornecedor.md` (N1–N8; N3 = valor de estoque do item com as 8 marcações), `~/Projects/omie-rea/regras/estoque-saldo-e-custo.md` (E1–E14) e `~/Projects/omie-rea/regras/evidencias-itens-recebimento.json`. Dados locais usados para os valores dos testes: `~/Projects/omie-rea/bruto/nf_itens_loja5.csv.gz` (D1) e `bruto/kardex_omie_loja5.csv.gz` (K1).

## Global Constraints

- Branch de trabalho: `paridade-omie` (HEAD `7443a5b3`). Cada task termina num commit; a mensagem termina com as duas linhas de atribuição da sessão (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_0183b5mkJcQaRjgHoMxzahgr`). Push e merge na `main` só com OK do dono.
- Deploy é manual (`ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`, síncrono), só depois de testado e com OK do dono no chat. Depois: `curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login` = `HTTP 200`. Build com cara de velho → `rm -rf .next` e build de novo.
- Migration é aplicada à mão, só com backup e OK: `ssh … "docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres" < supabase/migrations/NNN_x.sql`. Migration com `create index concurrently` vai **sem** `-1`/transação.
- Procedimento **P-MIG** (vale para toda migration deste plano): (1) conferir no servidor `grep NEXT_PUBLIC_SUPABASE_URL /opt/ntb-estoque/.env.local` = `http://127.0.0.1:8100` (banco certo); (2) backup: `bash /opt/ntb-estoque/scripts/backup-postgres-contabo.sh` + `pg_get_functiondef` de cada função que a migration recria salvo em `/root/backups-ntb-estoque/pre-NNN-<funcao>.sql`; (3) aplicar; (4) `\df <cada função tocada>` = **1 overload**; (5) `notify pgrst, 'reload schema';` (se a tela não enxergar a mudança, `docker restart supabase-rest`); (6) no lote de deploy: `desktop/scripts/gerar-schema.sh` + versão nova do app desktop.
- Procedimento **P-PROVA**: toda prova numérica é só leitura, medida como usuário logado (conta QA `claude.qa@ntb-estoque.dev`, cookie `sb-127-auth-token`, `fetch` em `127.0.0.1:3002`) ou SQL `set role authenticated`; nunca concluir pelo `supabase_admin`. Comparar origem (Omie/kardex) × destino (nosso), nunca o destino com ele mesmo.
- Escrita no Omie de produção só com OK explícito para aquela ação; antes, na loja de teste correspondente (escrita simulada: `integration_attempts.model like '[SIMULADO]%'`). Loja 4 nunca recebe escrita de teste.
- **Não mexer na Central de correções**: nada em `lib/correcoes/**`, `lib/actions/central.ts`, `app/(app)/estoque/correcoes/**`, nem nas funções SQL das migrations 171/172. Mudança em função compartilhada (`ajusteOmie`, `criarAjusteManual`) só com parâmetro opcional novo cujo padrão reproduz o comportamento de hoje.
- Módulo puro: sem alias `@/`, sem importar valor de outro `.ts` (só `import type`), teste com `node --test <arquivo>.test.ts`.
- Todo `.range()` vem com `.order('id')` (ou outra coluna única) na mesma query. RPC paginada precisa de `ORDER BY` determinístico.
- Todo `select` de `lojas` inclui `is_test`; consulta de `lojas` por coluna ≠ `id` inclui `.eq('is_test', false)`.
- Política RLS nova: `((select usuario_e_admin()) or loja_id in (select usuario_lojas()))` (padrão initplan da 156). Escrita em tabela nova só pelo `service_role`.
- Índice único parcial: nunca `.upsert()`/`onConflict` do supabase-js; usar `insert` + tratar `23505`, ou RPC.
- RPC que muda colunas de saída: `drop function` com a assinatura exata + `create function` (não dá `create or replace`).
- Mudou RPC `relatorio_compras_*` → replicar em `lib/relatorio-frio-nf.ts` no mesmo commit.
- Server action nova → `node scripts/inserir-via-desktop.mjs` (este plano não cria nenhuma; só acrescenta parâmetros opcionais).
- Espelho do Omie: nada de leitura em massa entre 00:00 e 07:00 America/Bahia (`janelaProibida`).
- Textos de tela em português, sem jargão; o produto se chama "Norte Estoque".

## Review Focus

- **Item sem as marcações de custo** (nota antiga, nota da SEFAZ/XML do estoque próprio, compra manual, `full_object` nulo): valor de estoque = valor fiscal, nunca 0 nem `NaN`. Teste em Task 4 (`sem itensCustoEstoque usa o valor fiscal`).
- **Frete/seguro no cabeçalho da nota e crédito do Simples (`itensICMSSN`)**: a regra N3 não tem caso real com frete/seguro (N3b é hipótese) nem com alíquota de crédito de PIS/COFINS > 0; o teste fixa o comportamento escolhido e diz que é hipótese, para a prova da Task 8 mostrar se diverge. Teste em Task 4 (`PIS/COFINS pela alíquota de crédito (HIPÓTESE)`).
- **Venda reenviada pelo Norte Vendas com os itens em outra ordem** (mesmo `pedidoRef`): a chave não pode depender da posição do item, senão duplica. Por isso a chave usa produto + ocorrência do produto no pedido. Teste em Task 9 (`itens reordenados geram as mesmas chaves`).
- **Venda sem `pedidoRef`**: não há como deduplicar; o fluxo tem que seguir funcionando como hoje (código por hora) e registrar aviso, sem quebrar. Teste em Task 9 (`sem pedidoRef cai no código por hora`).
- **Parâmetro `valor` ausente, inválido ou de link antigo, e os exports**: padrão `estoque`; o Excel/PDF/PPTX tem que receber o mesmo `valor` que a tela mostrou (bug "export ignora filtro" já visto na auditoria de 2026-08-09). Teste em Task 6 (`lerTipoValor` + params de export).

---

## Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `lib/compras/custo-estoque-item.ts` (+ `.test.ts`) — novo, puro | Regra N3 corrigida (valor de estoque do item), predicado "movimenta estoque", leitura do parâmetro `valor` | 4 |
| `supabase/migrations/175_custo_estoque_item_omie.sql` + `scripts/testes-sql/175_*.sql` | Mesmas regras em SQL (`custo_estoque_item_omie`, `item_movimenta_estoque`) | 4 |
| `supabase/migrations/176_compras_valor_estoque.sql` + teste SQL | `relatorio_compras_total/dim/matriz/detalhe` com `valor_estoque` e sem itens que não movimentam estoque | 5 |
| `lib/relatorio-frio-nf.ts` | Espelho JS das RPCs de Compras | 5 |
| `app/(app)/relatorio-compras/**`, `app/(app)/relatorio-indicadores/**`, `app/(app)/nota-fiscal/page.tsx`, `lib/notas-compras*.ts`, `lib/relatorio-compras-visoes.ts`, `lib/relatorio-mensal.ts`, `lib/dashboard-gerencial.ts` | Mostrar "valor de estoque" × "valor da nota" | 6 |
| `supabase/migrations/177_movimentacoes_nf_mov_estoque.sql`, `lib/movimentacao-operacao-auto.ts` | Movimentação sem itens "não movimenta estoque" | 7 |
| `lib/vendas/venda-idempotente.ts` (+ teste) — novo, puro; `supabase/migrations/178_venda_omie_idempotente.sql` | Chaves determinísticas da venda, vínculo venda→OP | 9, 10 |
| `lib/vendas-integracao.ts`, `lib/vendas-estorno.ts`, `app/api/integracao/ordem-producao/route.ts` | Venda → estoque sem duplicar, estorno sem log podado | 9, 10 |
| `lib/omie/motivo-ajuste.ts` (+ teste), `supabase/migrations/179_ajuste_manual_custo_informado.sql`, `lib/actions/movimentacoes.ts`, `lib/movimentos/reenviar-manual.ts`, `lib/actions/estoque-omie.ts`, `components/estoque-proprio/Acoes.tsx`, `components/movimentacoes/NovoAjusteManual.tsx` | Entrada com custo digitado, saída como perda (PER) | 11 |
| `supabase/migrations/180_nf_cancelada_proprio.sql` + teste SQL, `lib/estoque/nf-sefaz.ts`, `lib/estoque/sefaz-sync.ts`, `lib/actions/nota-fiscal-proprio.ts` | Nota cancelada estorna e nunca entra | 12 |
| `lib/estoque/compra-manual-puro.ts` (+ teste) — novo; `supabase/migrations/181_compra_manual_idempotente.sql`, `lib/actions/compras-proprio.ts`, `components/compras-proprio/CompraManual.tsx` | Compra manual idempotente | 13 |
| `supabase/migrations/182_fornecedor_da_nota_sefaz.sql` + teste SQL, `lib/actions/fornecedor.ts` | Fornecedor do XML vira cadastro | 14 |
| `lib/faturamento-periodo.ts` (+ teste), `app/(app)/relatorio-producao/page.tsx`, `supabase/migrations/183_lucro_repor_paginacao.sql`, `app/(app)/relatorio-lucro/dados.ts`, `app/(app)/home/page.tsx`, `app/(app)/produto/page.tsx` | Bugs menores do item 12 | 15 |

---

### Task 1: Itens 1–3 — aplicar 173/174, publicar `valorPorLocal` e provar contra o Omie [OK do dono]

Código já pronto nos commits `12c5b198` (migration 173 + `lib/estoque/kardex-cadeia-puro.ts`), `8dd3ab26` (`valorPorLocal` em `lib/estoque/espelho-omie.ts`) e `7443a5b3` (migration 174, `registrar_movimento`). Nada a escrever; só aplicar e provar.

**Files:** nenhum (só `supabase/migrations/173_saldo_em_data_cadeia.sql`, `174_registrar_movimento_saldo_negativo.sql` já existentes).

**Interfaces:**
- Consumes: `saldo_em_data(bigint, date)`, `primeiro_mov_apos(bigint, date)` (173, mesmas assinaturas da 160/161); `registrar_movimento(bigint,bigint,bigint,text,text,text,numeric,numeric,text,text,int,bigint,text,date)` (174, mesma da 132).
- Produces: produção com saldo em data na ordem do Omie (usado pela Task 2).

- [ ] **Step 1: Testes locais antes de tudo**

Run: `node --test lib/estoque/kardex-cadeia-puro.test.ts lib/estoque/espelho-omie.test.ts && npx tsc --noEmit`
Expected: todos PASS, `tsc` sem erro. SQL: `scripts/testes-sql/173_saldo_em_data_cadeia.sql` e `174_registrar_movimento_saldo_negativo.sql` numa cópia local (Postgres 17 em Docker com `pg_dump --schema-only` da produção) → `NOTICE: saldo_em_data / primeiro_mov_apos (cadeia) OK` e o OK da 174.

- [ ] **Step 2: Conferir produção antes (só leitura)**

Run (no servidor, psql): `\df saldo_em_data`, `\df primeiro_mov_apos`, `\df registrar_movimento` e `select saldo from saldo_em_data(5,'2026-08-31') where n_cod_prod=2453421862 and codigo_local_estoque=2424369390;`
Expected: 1 overload cada; saldo = `2504.5` (valor errado de hoje, prova de que a 173 não rodou).

- [ ] **Step 3: [OK do dono] Aplicar 173 e 174 pelo P-MIG**

Expected: `\df` 1 overload em cada função; `pg_get_functiondef('registrar_movimento'::regproc)` contém o ramo novo da 174 (pondera com saldo negativo; volta ao custo da entrada só quando `S₀+q = 0` ou o ponderado ≤ 0).

- [ ] **Step 4: [OK do dono] Merge `paridade-omie` → `main`, push e deploy**

Run: deploy síncrono + `curl` da Global Constraints.
Expected: `HTTP 200`.

- [ ] **Step 5: Prova numérica (P-PROVA)**

Run:
```sql
select saldo from saldo_em_data(5,'2026-08-31') where n_cod_prod=2453421862 and codigo_local_estoque=2424369390; -- Omie: 5500
select saldo from saldo_em_data(5,'2026-09-20') where n_cod_prod=2453421862 and codigo_local_estoque=2424369390; -- Omie: 3
```
e, como usuário logado, `/estoque?data=2026-08-31` (loja 5) mostra 5.500 nesse produto/local.
Para o valor por local: na foto mais recente de `posicao_estoques` da loja 5, `Σ n_saldo × (n_cmc do local se 0 < n_cmc < 1e7, senão n_cmc da sentinela local 0)` = total da tela `/estoque`; e esse total bate com a soma de "CMC Total" do relatório Posição de Estoque do Omie (leitura) puxado no mesmo horário da foto (em 17/10: R$ 1.629.684,06 por local × R$ 1.631.495,03 na tela antiga).
Para a 174 (loja 15): `select count(*) from estoque_movimentos where loja_id=15 and created_at > <deploy>` e, se houver entrada com saldo anterior negativo, conferir `CMC₁ = (S₀·C₀ + q·vu)/(S₀+q)` na linha.
Expected: 5500, 3, totais iguais (diferença ≤ R$ 0,05 por arredondamento).

---

### Task 2: Item 4 — religar o espelho completo da loja 5 e reler 09–16/10 [OK do dono — escrita em produção + carga de leitura no Omie]

O flag foi desligado de propósito durante a faxina do Mac (commits `8934518f`, `5490b27b`: "faxina (espelho_completo=false) — evita MISUSE"). O motor (`lib/estoque/espelho-frentes.ts`) recupera sozinho a partir de `recente.coberto_ate` em janelas de até 30 dias, e a frente de revisão relê 35 dias 1×/24 h e apaga do `kardex_omie` o que sumiu do Omie. Não há código a escrever.

**Files:** nenhum.

**Interfaces:**
- Consumes: Task 1 aplicada (a contagem de quebras usa as RPCs da 173).
- Produces: `kardex_omie` da loja 5 contínuo até hoje (a prova da Task 8 depende disso para outubro).

- [ ] **Step 1: Conferir estado e motivo (só leitura)**

Run: `select id, nome, is_test, espelho_completo from lojas where id = 5;` e `select frente, estado->'recente'->>'coberto_ate' as coberto, ultimo_erro, atualizado_em from espelho_sync_estado where loja_id = 5;` e perguntar ao dono se a faxina do Mac terminou.
Expected: `espelho_completo = false`, `coberto_ate` ≈ 2026-10-09. Faxina ainda rodando → parar aqui.

- [ ] **Step 2: Linha de base das quebras de cadeia (só leitura)**

Run:
```sql
with dias as (select d::date dia from generate_series('2026-08-13'::date, current_date - 1, '1 day') d),
fim as (select x.dia, s.* from dias x cross join lateral saldo_em_data(5, x.dia) s),
ini as (select x.dia, p.* from dias x cross join lateral primeiro_mov_apos(5, x.dia) p)
select fim.dia, count(*) filter (where abs(fim.saldo - (ini.saldo_apos - ini.quantidade)) > 0.000001) as quebras, count(*) as transicoes
from fim join ini using (dia, n_cod_prod, codigo_local_estoque)
where fim.data_mov = fim.dia
group by 1 order by 1;
```
Expected: ~86 quebras em ~6.103 transições, concentradas em 09–16/10 (GAPS G2.4a).

- [ ] **Step 3: [OK do dono] Ligar o flag, fora de 00:00–07:00 Bahia**

Run: `update lojas set espelho_completo = true where id = 5 and is_test = false returning id, espelho_completo;`
Expected: `5 | t`.

- [ ] **Step 4: Acompanhar a recuperação**

Run (a cada 30 min): a consulta do Step 1.
Expected: `kardex` e `ajustes` com `coberto_ate` = hoje e `ultimo_erro` nulo. `ultimo_erro` com `MISUSE_API_PROCESS` → não insistir: avisar o dono e (com OK) desligar o flag de novo; retomar só numa janela quieta.

- [ ] **Step 5: Prova (só leitura)**

Run: Step 2 de novo, depois que a revisão de 35 dias passou (≥ 24 h após o Step 3).
Expected: quebras de 09–16/10 caem para perto de 0 (sobram só movimentos retroativos/cancelados, abaixo de 1,4 % das transições). Além disso, `saldo_em_data(5, current_date)` × foto mais recente de `posicao_estoques` por produto+local: divergências só em produtos movimentados depois da foto.

---

### Task 3: Item 13 — `SUPABASE_DB_URL` do servidor aponta para o banco antigo [checar primeiro; OK do dono para trocar]

O app não usa essa variável (`grep -rn SUPABASE_DB_URL app lib` = 0); só os scripts usam (`scripts/db.mjs`, `sync-financeiro.mjs`, `sync-ajustes-omie.mjs`, `sync-faturamento-api.mjs`, `arquivar-ops.mjs`, `restaurar-itens-detalhes.mjs`, `limpar-full-object-ops.mjs`, `aplicar-indices-concurrently.mjs`, `testar-pooler.mjs`, `probe-financeiro-total.mjs`). Fazer antes de qualquer migration deste plano.

**Files:** nenhum no repo (só `/opt/ntb-estoque/.env.local` no servidor).

**Interfaces:** nenhuma.

- [ ] **Step 1: Ver o host, sem senha (só leitura)**

Run: `ssh … "grep -E '^(SUPABASE_DB_URL|NEXT_PUBLIC_SUPABASE_URL)=' /opt/ntb-estoque/.env.local | sed -E 's#(://[^:]+:)[^@]+@#\1***@#'"`
Expected (bug confirmado): `SUPABASE_DB_URL` com host `*.supabase.co`/`*.pooler.supabase.com` e `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8100`. Se já aponta para o self-hosted, registrar e encerrar a task.

- [ ] **Step 2: Quem usa a variável no servidor (só leitura)**

Run: `ssh … "crontab -l; systemctl list-timers --all | grep -i ntb; grep -l SUPABASE_DB_URL /opt/ntb-estoque/scripts/*.mjs"` e `ssh … "docker ps --format '{{.Names}} {{.Ports}}' | grep -E 'supabase-(db|pooler)'"`
Expected: lista dos agendamentos que rodam esses scripts (ex.: `sync-financeiro.mjs`) e a porta do Postgres self-hosted.

- [ ] **Step 3: [OK do dono] Trocar a variável**

Run: `cp .env.local .env.local.bak-<data>` e trocar `SUPABASE_DB_URL` pela URL do Postgres self-hosted (mesmo usuário/senha do `supabase-db`).
Expected: arquivo salvo; nenhum restart do app necessário.

- [ ] **Step 4: Prova**

Run: no servidor, `node -e` com `pg` lendo `SUPABASE_DB_URL` → `select inet_server_addr(), (select count(*) from lojas), (select max(created_at) from movimentos)`.
Expected: endereço local/da rede Docker e contagens iguais às do app (não as do banco congelado). Registrar no AGENTS.md (seção de infra) no commit da Task 15.

---

### Task 4: Regra do valor de estoque do item (N3 corrigida) e "movimenta estoque" — puro + SQL (migration 175)

Achado ao reprocessar D1 × K1 (loja 5, notas concluídas desde 01/08, 1.021 pares nota × produto): o `vTotalItem` do Omie **já vem sem o desconto** e já inclui IPI, ICMS-ST e a parte do item nas outras despesas (`vTotalItem = qtde × preço − vDesconto + IPI + ST + despesas`). A N3 escrita subtrai `vDesconto` de novo (1.009/1.021 = 98,8 %); sem isso bate 1.014/1.021 = 99,3 %, e as despesas do item saem exatas por diferença, sem ratear o cabeçalho. Quantidade × preço (o que os relatórios usam hoje) bate só 856/1.021 = 83,8 %.

**Files:**
- Create: `lib/compras/custo-estoque-item.ts`, `lib/compras/custo-estoque-item.test.ts`
- Create: `supabase/migrations/175_custo_estoque_item_omie.sql`, `scripts/testes-sql/175_custo_estoque_item_omie.sql`

**Interfaces:**
- Produces (TS):
  - `type FlagsCustoOmie = { cICMSCusto?: string; cICMSSTCusto?: string; cIPICusto?: string; cPISCusto?: string; cCOFINSCusto?: string; cOutrosDespCusto?: string; cFreteCusto?: string; cSeguroCusto?: string; nAliqCredPISCusto?: number | string; nAliqCredCOFINSCusto?: number | string }`
  - `type EntradaCustoItem = { qtde: number; precoUnit: number; vTotalItem: number | null; vDesconto: number; vIPI: number; vST: number; vICMS: number; flags: FlagsCustoOmie | null }`
  - `type CustoItem = { valorFiscal: number; valorEstoque: number; despesas: number; fonte: 'omie' | 'fiscal' }`
  - `entradaCustoDoItem(fullObject: unknown, qtde: unknown, precoUnit: unknown): EntradaCustoItem` — lê `itensCabec.vTotalItem`, `itensCabec.vDesconto`, `itensIPI.nValIPI`, `itensICMSST.nValorST`, `itensICMS.nValor`, `itensCustoEstoque`.
  - `custoEstoqueItemOmie(e: EntradaCustoItem): CustoItem`
  - `itemMovimentaEstoque(fullObject: unknown): boolean` — falso se `itensAjustes.cNaoGerarMovEstoque = 'S'` ou `itensCabec.cIgnorarItem = 'S'`; `cNaoGerarFinanceiro` **não** tira o item (no Omie ele continua entrando no estoque).
  - `type TipoValorCompra = 'estoque' | 'fiscal'`; `lerTipoValor(v: string | string[] | null | undefined): TipoValorCompra` (padrão `'estoque'`).
- Produces (SQL, `immutable parallel safe`): `custo_estoque_item_omie(p_fo jsonb, p_qtde numeric, p_preco numeric) returns numeric`; `item_movimenta_estoque(p_fo jsonb) returns boolean`. `grant execute … to authenticated, service_role`.

- [ ] **Step 1: Escrever os testes que falham** (valores reais de D1/K1, loja 5)

```ts
const N = { cICMSCusto:'N', cICMSSTCusto:'N', cIPICusto:'N', cPISCusto:'N', cCOFINSCusto:'N', cOutrosDespCusto:'N', cFreteCusto:'N', cSeguroCusto:'N', nAliqCredPISCusto:0, nAliqCredCOFINSCusto:0 }
const e = (o) => ({ qtde:1, precoUnit:0, vTotalItem:null, vDesconto:0, vIPI:0, vST:0, vICMS:0, flags:N, ...o })

test('ICMS fora do custo: ESPONJA 60034, NF 184507 (kardex 1 × 5,17)', () => {
  const r = custoEstoqueItemOmie(e({ qtde:1, precoUnit:6.5, vTotalItem:6.5, vICMS:1.33 }))
  assert.equal(r.valorEstoque, 5.17); assert.equal(r.valorFiscal, 6.5); assert.equal(r.fonte, 'omie')
})
test('ICMS N, IPI e ST S: ALHO 80009, NF 952367 (kardex 26,23)', () => {
  assert.equal(custoEstoqueItemOmie(e({ precoUnit:33, vTotalItem:33, vICMS:6.77, flags:{ ...N, cIPICusto:'S', cICMSSTCusto:'S' } })).valorEstoque, 26.23)
})
test('desconto já está no vTotalItem: PESCADA 80104, NF 4063 (kardex 77 × 41,531558)', () => {
  const r = custoEstoqueItemOmie(e({ qtde:77, precoUnit:41.7, vTotalItem:3197.93, vDesconto:12.97, flags:{ ...N, cIPICusto:'S', cICMSSTCusto:'S' } }))
  assert.equal(r.valorEstoque, 3197.93); assert.notEqual(r.valorEstoque, 3184.96); assert.equal(r.despesas, 0)
  assert.ok(Math.abs(r.valorFiscal - 3210.9) < 1e-9)
})
test('outras despesas saem do item quando N: ÁGUA C/ GÁS 90001, NF 131055 (kardex 144 × 1,214167)', () => {
  const r = custoEstoqueItemOmie(e({ qtde:12, precoUnit:14.570054, vTotalItem:189.23 }))
  assert.equal(r.despesas, 14.39); assert.equal(r.valorEstoque, 174.84)
})
test('IPI N e despesas N: H2O 90015, NF 131055 (kardex 24 × 4,164167)', () => {
  const r = custoEstoqueItemOmie(e({ qtde:2, precoUnit:49.971587, vTotalItem:109.88, vIPI:1.58 }))
  assert.equal(r.despesas, 8.36); assert.equal(r.valorEstoque, 99.94)
})
test('tudo no custo: PAPEL FILME 60087, NF 189213 = valor fiscal 119,80', () => {
  const S = Object.fromEntries(Object.entries(N).map(([k, v]) => [k, typeof v === 'string' ? 'S' : v]))
  assert.equal(custoEstoqueItemOmie(e({ qtde:2, precoUnit:59.9, vTotalItem:119.8, vICMS:24.56, flags:S })).valorEstoque, 119.8)
})
test('ST dentro do vTotalItem: RECORTE 69062, NF 360369 (sem kardex) — ST N tira 11,79', () => {
  const base = { qtde:20, precoUnit:11.5, vTotalItem:241.79, vST:11.79 }
  assert.equal(custoEstoqueItemOmie(e({ ...base, flags:{ ...N, cICMSSTCusto:'S' } })).valorEstoque, 241.79)
  assert.equal(custoEstoqueItemOmie(e(base)).valorEstoque, 230)
})
test('PIS/COFINS pela alíquota de crédito (HIPÓTESE N3: nenhum caso real em D1)', () => {
  assert.equal(custoEstoqueItemOmie(e({ qtde:1, precoUnit:100, vTotalItem:100, flags:{ ...N, nAliqCredPISCusto:1.65, nAliqCredCOFINSCusto:7.6 } })).valorEstoque, 90.75)
})
test('sem itensCustoEstoque usa o valor fiscal', () => {
  const r = custoEstoqueItemOmie(entradaCustoDoItem({ itensCabec:{} }, 4, 54.9))
  assert.equal(r.fonte, 'fiscal'); assert.equal(r.valorEstoque, 219.6)
  assert.equal(custoEstoqueItemOmie(entradaCustoDoItem(null, '2', '3')).valorEstoque, 6)
})
test('entradaCustoDoItem lê o JSON do Omie (NF 131055 item 5)', () => {
  const fo = { itensCabec:{ vTotalItem:109.88, vDesconto:0 }, itensIPI:{ nValIPI:1.58 }, itensICMSST:{ nValorST:0 }, itensICMS:{}, itensCustoEstoque:N }
  const x = entradaCustoDoItem(fo, 2, 49.971587)
  assert.equal(x.vIPI, 1.58); assert.equal(x.vTotalItem, 109.88); assert.equal(custoEstoqueItemOmie(x).valorEstoque, 99.94)
})
test('itemMovimentaEstoque', () => {
  assert.equal(itemMovimentaEstoque({ itensAjustes:{ cNaoGerarMovEstoque:'S' } }), false)
  assert.equal(itemMovimentaEstoque({ itensCabec:{ cIgnorarItem:'S' } }), false)
  assert.equal(itemMovimentaEstoque({ itensAjustes:{ cNaoGerarFinanceiro:'S', cNaoGerarMovEstoque:'N' } }), true)
  assert.equal(itemMovimentaEstoque(null), true)
})
test('lerTipoValor', () => {
  assert.equal(lerTipoValor(undefined), 'estoque'); assert.equal(lerTipoValor('xyz'), 'estoque')
  assert.equal(lerTipoValor('fiscal'), 'fiscal'); assert.equal(lerTipoValor(['fiscal']), 'fiscal')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/compras/custo-estoque-item.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar em `lib/compras/custo-estoque-item.ts`**

Regra (flag ausente = `'N'`; arredondar a centavos com `Math.round((x + Number.EPSILON) * 100) / 100`):
```
valorFiscal = qtde × precoUnit                     (sem arredondar: é o número de hoje das RPCs)
sem flags (itensCustoEstoque ausente) ou vTotalItem nulo → valorEstoque = round2(valorFiscal), despesas 0, fonte 'fiscal'
despesas    = max(0, round2(vTotalItem − (qtde × precoUnit − vDesconto) − vIPI − vST))
valorEstoque = round2(vTotalItem
   − (cIPICusto  ='N' ? vIPI : 0) − (cICMSSTCusto='N' ? vST : 0) − (cICMSCusto='N' ? vICMS : 0)
   − (cPISCusto  ='N' ? vTotalItem × nAliqCredPISCusto/100 : 0)
   − (cCOFINSCusto='N' ? vTotalItem × nAliqCredCOFINSCusto/100 : 0)
   − (cOutrosDespCusto='N' ? despesas : 0))
```
`despesas` junta frete/seguro/outras do item (N3b: sem caso real de frete/seguro — comentário no código apontando a hipótese).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/compras/custo-estoque-item.test.ts`
Expected: PASS (11 testes).

- [ ] **Step 5: Migration 175 + teste SQL**

`175_custo_estoque_item_omie.sql`: as duas funções SQL com a mesma regra (lendo `p_fo->'itensCabec'->>'vTotalItem'` etc., `coalesce(...,0)`, `nullif(...,'')::numeric`). Sem tabela, sem índice. Comentário no topo citando esta task e a correção da N3.
`scripts/testes-sql/175_custo_estoque_item_omie.sql`: `do $$ … $$` com os mesmos 7 casos reais do Step 1 montados como `jsonb` (ex.: `custo_estoque_item_omie('{"itensCabec":{"vTotalItem":3197.93,"vDesconto":12.97},"itensCustoEstoque":{"cIPICusto":"S","cICMSSTCusto":"S"}}', 77, 41.7) = 3197.93`) e `item_movimenta_estoque` nos 4 casos; `raise exception` na primeira diferença.
Run: Postgres 17 local (`docker run -d --name pg-teste -e POSTGRES_PASSWORD=x postgres:17`; `docker exec -i pg-teste psql -U postgres < supabase/migrations/175_…sql` e depois `< scripts/testes-sql/175_…sql`).
Expected: `NOTICE: custo_estoque_item_omie OK`.

- [ ] **Step 6: Commit**

```bash
git add lib/compras/custo-estoque-item.ts lib/compras/custo-estoque-item.test.ts supabase/migrations/175_custo_estoque_item_omie.sql scripts/testes-sql/175_custo_estoque_item_omie.sql
git commit -m "feat(compras): valor de estoque do item na regra do Omie (N3 corrigida, migration 175)"
```

---

### Task 5: RPCs de Compras com `valor_estoque` e sem itens que não movimentam estoque (migration 176) [itens 5 e 6]

Hoje `097:38,80,125,177` somam `n_qtde_nfe × n_preco_unit` e nenhuma RPC de Compras olha `cNaoGerarMovEstoque` (só a auditoria fiscal, `097:222,270`). A auditoria fiscal não muda (ela mostra os dois flags de propósito).

**Files:**
- Create: `supabase/migrations/176_compras_valor_estoque.sql`, `scripts/testes-sql/176_compras_valor_estoque.sql`
- Modify: `lib/relatorio-frio-nf.ts:172` (`valorDe`), `:210-243` (`filtrarItensCompras`), `:244-283` (`agregarComprasTotal`, `agregarComprasMatriz`), `:285-315` (`LinhaDetalheCompra`, `mapearComprasDetalhe`)

**Interfaces:**
- Consumes: `custo_estoque_item_omie`, `item_movimenta_estoque` (Task 4); `custoEstoqueItemOmie`, `entradaCustoDoItem`, `itemMovimentaEstoque` (Task 4, importados com `@/lib/compras/custo-estoque-item`).
- Produces (SQL, mesmos parâmetros da 097):
  - `relatorio_compras_total(...) returns table(valor numeric, n_notas bigint, valor_estoque numeric)`
  - `relatorio_compras_dim(...) returns table(rotulo text, valor numeric, itens bigint, valor_estoque numeric)`
  - `relatorio_compras_matriz(...) returns table(rotulo text, mes text, valor numeric, valor_estoque numeric)`
  - `relatorio_compras_detalhe(...) returns table(<colunas da 097>, valor_estoque numeric)`
  - `valor` continua = quantidade × preço (valor da nota), para nenhum consumidor mudar sem querer.
- Produces (TS): `agregarComprasTotal(itens): { valor: number; valorEstoque: number; nNotas: number }`; `agregarComprasMatriz(...)` devolve `{ rotulo; mes; valor; valor_estoque }[]`; `LinhaDetalheCompra` ganha `valor_estoque: number`; `filtrarItensCompras` também exclui `!itemMovimentaEstoque(it.full_object)`.

- [ ] **Step 1: Escrever o teste SQL que falha**

`scripts/testes-sql/176_compras_valor_estoque.sql` (cópia local com `pg_dump --schema-only` da produção + 175 e 176 aplicadas): insere 1 loja/produto/nota concluída (`c_etapa='60'`, emissão 2026-10-13) com 3 itens: PESCADA da Task 4 (77 × 41,7; `vTotalItem` 3197,93; desconto 12,97), ESPONJA (1 × 6,5; ICMS 1,33; tudo N) e um item com `cNaoGerarMovEstoque='S'` (10 × 10). Asserções:
```sql
-- relatorio_compras_total(p_loja_id, '2026-10-01', '2026-10-31')
valor = 3210.9 + 6.5            -- 3217.40: o item que não movimenta estoque some
valor_estoque = 3197.93 + 5.17  -- 3203.10
n_notas = 1
-- relatorio_compras_matriz(..., p_dim => 'produto'): 2 linhas; soma de valor_estoque = 3203.10
```

- [ ] **Step 2: Rodar e ver falhar**

Run: o teste na cópia local antes de aplicar a 176.
Expected: FAIL (`column "valor_estoque" does not exist`).

- [ ] **Step 3: Escrever a 176**

`drop function if exists` das 4 com as assinaturas exatas da 097 (`relatorio_compras_total(bigint,date,date,text[],text[],text,text[],text,bigint,text)`, `relatorio_compras_dim(bigint,date,date,text,text[],text[],text,text[],text,bigint,text)`, `relatorio_compras_matriz(` idem `)`, `relatorio_compras_detalhe(bigint,date,date,text[],text[],text,text[],text,bigint,text)`), depois `create function` com o corpo da 097 + `and item_movimenta_estoque(i.full_object)` no `where` + a coluna `sum(custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit))::numeric as valor_estoque` (no detalhe, sem `sum`). Ordem de saída igual à 097. `notify pgrst, 'reload schema'` no fim.

- [ ] **Step 4: Espelhar em `lib/relatorio-frio-nf.ts`**

Assinaturas da seção Interfaces; `valorEstoqueDe(it) = custoEstoqueItemOmie(entradaCustoDoItem(it.full_object, it.n_qtde_nfe, it.n_preco_unit)).valorEstoque`.

- [ ] **Step 5: Rodar e ver passar**

Run: teste SQL do Step 1 + `npx tsc --noEmit`.
Expected: `NOTICE … OK`; `tsc` acusa os chamadores que leem os tipos novos (resolvidos na Task 6). Se a Task 6 vier junto no mesmo lote, `tsc` limpo no fim dela.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/176_compras_valor_estoque.sql scripts/testes-sql/176_compras_valor_estoque.sql lib/relatorio-frio-nf.ts
git commit -m "feat(compras): RPCs de Compras com valor de estoque e sem itens que não movimentam estoque (migration 176)"
```

---

### Task 6: Telas e relatórios mostram "valor de estoque" × "valor da nota" [item 5]

Compras, Indicadores, Notas Fiscais, Relatório mensal (PPTX) e Dashboard gerencial. Padrão = valor de estoque (o mesmo do Omie); o valor da nota continua visível ao lado.

**Files:**
- Modify: `lib/relatorio-compras-visoes.ts` (+ `.test.ts`), `lib/notas-compras.ts` (+ `.test.ts`), `lib/notas-compras-loader.ts:135-191`
- Modify: `app/(app)/relatorio-compras/page.tsx:176-259`, `.../export/route.ts:124-158`, `.../export-completo/route.ts:139-184`
- Modify: `app/(app)/relatorio-indicadores/page.tsx:154-214`, `.../export/route.ts:92-134`
- Modify: `app/(app)/nota-fiscal/page.tsx` (visões Produtos/Famílias/Por dia/Evolução), `lib/relatorio-mensal.ts:164-183,298-299`, `lib/relatorio-mensal-pptx.ts` (rótulo), `lib/dashboard-gerencial.ts:152-201`

**Interfaces:**
- Consumes: `TipoValorCompra`, `lerTipoValor` (Task 4); colunas `valor_estoque` (Task 5).
- Produces:
  - `relatorio-compras-visoes.ts`: `type LinhaMesCompraDupla = LinhaMesCompra & { valor_estoque: number }`; `comTipoValor(linhas: LinhaMesCompraDupla[], tipo: TipoValorCompra): LinhaMesCompra[]` (copia `valor_estoque` para `valor` quando `tipo='estoque'`).
  - `notas-compras.ts`: `ItemCompra` ganha `valorEstoque: number`; `itemParaLinha(i: ItemCompra, tipo: TipoValorCompra = 'estoque'): LinhaPainel`.
  - URL: parâmetro `valor=estoque|fiscal` em todas essas telas e nos links de export.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// lib/relatorio-compras-visoes.test.ts
test('comTipoValor troca o valor pelo de estoque', () => {
  const L = [{ rotulo:'PEIXES', mes:'2026-10', valor:3210.9, valor_estoque:3197.93 }]
  assert.equal(comTipoValor(L, 'estoque')[0].valor, 3197.93)
  assert.equal(comTipoValor(L, 'fiscal')[0].valor, 3210.9)
  assert.equal(rankingCompras(comTipoValor(L, 'estoque'))[0].valor, 3197.93)
})
// lib/notas-compras.test.ts
test('itemParaLinha usa o valor de estoque por padrão', () => {
  const i = { notaId:1, dia:'2026-10-13', idProduto:2657120569, produto:'Peixe pescada amarela', tipoCod:'01', tipo:'Matéria-prima', familia:'PEIXES', unidade:'KG', quant:77, valor:3210.9, valorEstoque:3197.93 }
  assert.equal(itemParaLinha(i).valor, 3197.93)
  assert.equal(itemParaLinha(i, 'fiscal').valor, 3210.9)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/relatorio-compras-visoes.test.ts lib/notas-compras.test.ts`
Expected: FAIL (`comTipoValor` inexistente; `itemParaLinha` devolve 3210.9).

- [ ] **Step 3: Implementar**

- Puros: assinaturas acima.
- `carregarItensCompra`: o `select` ganha caminhos JSON (`vtot:full_object->itensCabec->>vTotalItem`, `vdesc:full_object->itensCabec->>vDesconto`, `ipi:full_object->itensIPI->>nValIPI`, `st:full_object->itensICMSST->>nValorST`, `icms:full_object->itensICMS->>nValor`, `custo:full_object->itensCustoEstoque`, `naomov:full_object->itensAjustes->>cNaoGerarMovEstoque`, `ignorar:full_object->itensCabec->>cIgnorarItem`) em vez do `full_object` inteiro; monta `EntradaCustoItem` e chama `custoEstoqueItemOmie`; itens que não movimentam estoque ficam de fora (mesma regra das RPCs).
- Compras: `tipoValor = lerTipoValor(sp.valor)`; ranking/matriz via `comTipoValor`; cartão "Total comprado" mostra o valor escolhido e, embaixo, o outro ("Valor das notas: R$ X" / "Valor que entrou no estoque: R$ Y"); `SegmentLinks` "Valor de estoque | Valor da nota" (preserva os demais parâmetros); `exportParams` leva `valor`; Excel do detalhe ganha a coluna "Valor de estoque"; matriz do Excel usa o valor escolhido; subtítulo da planilha diz qual.
- Indicadores: Compras ÷ Faturamento com `valor_estoque` por padrão (toggle igual); o export recebe `valor`.
- Notas Fiscais: visões por item usam `itemParaLinha(i, tipoValor)`; o cartão "Total comprado" (cabeçalho `n_valor_nfe`) não muda.
- Relatório mensal (PPTX) e dashboard gerencial: `valor_estoque`; rótulo "Compras (valor de estoque, como no Omie)".

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/relatorio-compras-visoes.test.ts lib/notas-compras.test.ts lib/compras/custo-estoque-item.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` limpo.

- [ ] **Step 5: Commit**

```bash
git add lib/relatorio-compras-visoes.ts lib/relatorio-compras-visoes.test.ts lib/notas-compras.ts lib/notas-compras.test.ts lib/notas-compras-loader.ts "app/(app)/relatorio-compras" "app/(app)/relatorio-indicadores" "app/(app)/nota-fiscal/page.tsx" lib/relatorio-mensal.ts lib/relatorio-mensal-pptx.ts lib/dashboard-gerencial.ts
git commit -m "feat(compras): telas e relatórios com valor de estoque × valor da nota"
```

---

### Task 7: Movimentação sem itens "não movimenta estoque" (migration 177) [item 6]

Duas fontes: a RPC `movimentacoes_loja` (`170:137-147`, entradas de NF) e o "Por operação (R$)" de `lib/movimentacao-operacao-auto.ts:129-173`. Só a exclusão muda aqui; a valoração da Movimentação pelo valor do movimento é a Fase D (N13), e quantidade recebida ≠ quantidade da nota é a Fase B (D3).

**Files:**
- Create: `supabase/migrations/177_movimentacoes_nf_mov_estoque.sql`, `scripts/testes-sql/177_movimentacoes_nf_mov_estoque.sql`
- Modify: `lib/movimentacao-operacao-auto.ts:155-173`

**Interfaces:**
- Consumes: `item_movimenta_estoque` (Task 4), `itemMovimentaEstoque` (Task 4).
- Produces: `movimentacoes_loja(bigint,date,date,bigint[],bigint,text,text,text,integer,integer)` com a mesma assinatura e saída da 170.

- [ ] **Step 1: Teste SQL que falha**

Na cópia local: nota concluída com 2 itens (um com `cNaoGerarMovEstoque='S'`); `select count(*) from movimentacoes_loja(<loja>, '2026-10-01','2026-10-31') where origem = 'nf'` = 1.

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL (vem 2).

- [ ] **Step 3: Implementar**

177 = `create or replace function public.movimentacoes_loja(...)` com o corpo da 170 e só `and item_movimenta_estoque(it.full_object)` no bloco de NF; mesmos `revoke/grant`. Em `movimentacao-operacao-auto.ts`, `if (!itemMovimentaEstoque(it.full_object)) continue` antes do `add`.

- [ ] **Step 4: Rodar e ver passar**

Run: teste SQL + `npx tsc --noEmit`.
Expected: 1; `tsc` limpo.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/177_movimentacoes_nf_mov_estoque.sql scripts/testes-sql/177_movimentacoes_nf_mov_estoque.sql lib/movimentacao-operacao-auto.ts
git commit -m "fix(movimentacoes): itens 'não movimenta estoque' fora da Movimentação (migration 177)"
```

---

### Task 8: Lote G1.1/G1.4 em produção e prova contra o Omie [OK do dono: 175, 176, 177 e deploy]

**Files:** nenhum.

**Interfaces:** Consumes Tasks 4–7; para outubro, Task 2 (kardex da loja 5 contínuo).

- [ ] **Step 1: Medir G1.4 em todas as lojas antes (só leitura)**

Run:
```sql
select loja_id,
  count(*) filter (where full_object->'itensAjustes'->>'cNaoGerarMovEstoque' = 'S') as nao_mov,
  count(*) filter (where full_object->'itensCabec'->>'cIgnorarItem' = 'S') as ignorar,
  count(*) filter (where full_object->'itensAjustes'->>'cNaoGerarFinanceiro' = 'S') as nao_fin
from nota_fiscal_items group by 1 order by 1;
```
Expected: registro do tamanho real. Em D1 (loja 5, desde 01/08): 0 `nao_mov`, 0 `nao_fin`, 38 `ignorar` (todos em notas não concluídas). Efeito pequeno na loja 5; anotar as outras lojas.

- [ ] **Step 2: [OK do dono] Aplicar 175 → 176 → 177 (P-MIG), merge, deploy, `gerar-schema.sh` + versão do desktop**

Expected: `\df` 1 overload em `custo_estoque_item_omie`, `item_movimenta_estoque`, nas 4 `relatorio_compras_*` e em `movimentacoes_loja`; `HTTP 200`.

- [ ] **Step 3: Prova item a item contra o kardex do Omie (só leitura)**

Run:
```sql
with it as (
  select ltrim(nf.c_numero_nfe,'0') num, i.n_id_produto prod,
         sum(custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit)) v, sum(i.n_qtde_nfe * i.n_preco_unit) fiscal
  from nota_fiscal_items i join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  where i.loja_id = 5 and nf.deleted_at is null and nf_bate_status(nf.c_etapa, nf.full_object, 'CONCLUIDA')
    and nf.d_emissao_nfe >= '2026-08-01' and item_movimenta_estoque(i.full_object)
  group by 1, 2),
k as (
  select ltrim(num_doc,'0') num, n_cod_prod prod, sum(quantidade * valor_unit) v
  from kardex_omie where loja_id = 5 and des_origem = 'Compra de Produto' and not coalesce(cancelado, false)
  group by 1, 2)
select count(*) pares,
       count(*) filter (where abs(it.v - k.v) <= greatest(0.02, abs(k.v) * 0.0005)) estoque_ok,
       count(*) filter (where abs(it.fiscal - k.v) <= greatest(0.02, abs(k.v) * 0.0005)) fiscal_ok
from it join k using (num, prod);
```
Expected: ~99,3 % `estoque_ok` (D1: 1.014/1.021) contra ~83,8 % `fiscal_ok` (856/1.021). Abaixo de 98 % → parar e investigar os pares que não batem (as 7 sobras conhecidas são recebimento parcial e reavaliação posterior do Omie).

- [ ] **Step 4: Prova na tela (P-PROVA)**

Run: `/relatorio-compras?ini=2026-08-01&fim=2026-08-31` e `…09-01…09-30` (loja 5, Concluídas), nos dois modos de `valor`; conferir contra `relatorio_compras_total` direto.
Expected: tela = SQL exato. Ordem de grandeza (D1, sem o corte de CFOP 908/910): ago fiscal R$ 276.452,12 × estoque R$ 267.991,57; set fiscal R$ 288.738,16 × estoque R$ 277.565,99 (≈ −3 % a −4 %). PPTX e Indicadores mostram o mesmo número de estoque.

---

### Task 9: Venda → estoque com código de OP derivado do pedido (migration 178) [item 7, parte 1 — risco: fluxo de venda ao vivo das lojas 4 e 5]

Hoje `lib/vendas-integracao.ts:231` usa `NTBV${Date.now()}${indice}`: o Norte Vendas reenviando o mesmo pedido cria outra OP. (A fila `vendas_integracao_fila` já reusa o `cCodIntOP` gravado e trata "já existe" como ok — o duplicado vem do reenvio do pedido.) O prefixo `NTBV` fica (é por ele que `origemDaOP` mostra "Norte Vendas").

**Files:**
- Create: `lib/vendas/venda-idempotente.ts`, `lib/vendas/venda-idempotente.test.ts`, `supabase/migrations/178_venda_omie_idempotente.sql`
- Modify: `lib/vendas-integracao.ts:53-115` (`tentarOp`), `:198-255` (`processarItemVenda`); `app/api/integracao/ordem-producao/route.ts:107-115`

**Interfaces:**
- Produces (puro):
  - `codIntOPVenda(pedidoRef: string, codigoProduto: number, ocorrencia: number): string` → `NTBV-` + 13 caracteres (mesmo algoritmo de `hashCurto`, copiado: módulo puro não importa valor), ≤ 20, `pedidoRef` em minúsculas.
  - `chaveSaidaVenda(pedidoRef: string, codigoProduto: number, ocorrencia: number): string` → `VND-` + 13.
  - `ocorrenciasPorCodigo(itens: { codigo: string }[]): number[]` (0 na 1ª vez que o código aparece no pedido, 1 na 2ª…).
  - `type VinculoOP = { cod_int_op: string; n_cod_op: number | null; estado: 'incluindo' | 'criada' | 'concluida' | 'estornada' }`
  - `decidirOPVenda(v: VinculoOP | null): 'incluir' | 'consultar' | 'concluir' | 'pronta'`
- Produces (SQL 178): tabela `venda_op_vinculo (id bigserial pk, loja_id bigint not null references lojas on delete cascade, pedido_ref text not null, codigo_produto bigint not null, ocorrencia int not null, cod_int_op text not null, n_cod_op bigint, estado text not null default 'incluindo' check (estado in ('incluindo','criada','concluida','estornada')), criado_em timestamptz default now(), atualizado_em timestamptz default now(), unique (loja_id, cod_int_op))` + índice `(loja_id, pedido_ref)`; RLS só leitura no padrão initplan; `alter table movimentos add column if not exists venda_chave text` + `create unique index concurrently if not exists movimentos_venda_chave_uq on movimentos (loja_id, venda_chave) where venda_chave is not null` (aplicar **sem** `-1`).
- `processarItemVenda(supabase, loja, item, ctx: { pedidoRef: string | null; obs: string; dData: string; indice: number; ocorrencia: number; cupom?: … })`.

- [ ] **Step 1: Testes que falham**

```ts
const REF = '3f6c2a9e-1b7d-4c55-9a0e-2d8f4b6c1e07'
test('código determinístico, ≤ 20, prefixo NTBV', () => {
  const a = codIntOPVenda(REF, 2459363119, 0)
  assert.equal(a, codIntOPVenda(REF.toUpperCase(), 2459363119, 0))
  assert.ok(a.startsWith('NTBV-') && a.length <= 20)
  assert.notEqual(a, codIntOPVenda(REF, 2459363119, 1))
  assert.notEqual(a, codIntOPVenda(REF, 2453427633, 0))
})
test('itens reordenados geram as mesmas chaves', () => {
  const p1 = [{ codigo:'A' }, { codigo:'B' }, { codigo:'A' }], p2 = [{ codigo:'B' }, { codigo:'A' }, { codigo:'A' }]
  assert.deepEqual(ocorrenciasPorCodigo(p1), [0, 0, 1]); assert.deepEqual(ocorrenciasPorCodigo(p2), [0, 0, 1])
})
test('chave da saída ≠ código da OP e cabe no texto', () => {
  const s = chaveSaidaVenda(REF, 2459363119, 0)
  assert.ok(s.startsWith('VND-') && s.length <= 20)
})
test('decidirOPVenda', () => {
  assert.equal(decidirOPVenda(null), 'incluir')
  assert.equal(decidirOPVenda({ cod_int_op:'x', n_cod_op:null, estado:'incluindo' }), 'consultar')
  assert.equal(decidirOPVenda({ cod_int_op:'x', n_cod_op:123, estado:'criada' }), 'concluir')
  assert.equal(decidirOPVenda({ cod_int_op:'x', n_cod_op:123, estado:'concluida' }), 'pronta')
  assert.equal(decidirOPVenda({ cod_int_op:'x', n_cod_op:123, estado:'estornada' }), 'pronta')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/vendas/venda-idempotente.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

- Puro: assinaturas acima.
- Rota: calcula `ocorrenciasPorCodigo(body.itens)` e passa `ocorrencia` para cada `processarItemVenda`.
- `processarItemVenda`: com `pedidoRef`, `cCodIntOP = codIntOPVenda(...)`, lê o vínculo por `(loja_id, cod_int_op)` e segue `decidirOPVenda`: `incluir` → `insert` do vínculo (`23505` = outra execução já está nele → `consultar`) e `tentarOp`; `consultar` → `consultarOPPorCodInt` (`lib/omie/ordem-producao.ts:537`); achou → grava `n_cod_op` e conclui se preciso; não achou → `incluir`; `concluir` → só `concluirOrdemProducao`; `pronta` → não chama o Omie. Sem `pedidoRef` → código por hora de sempre + `console.warn('venda sem pedidoRef: sem proteção contra reenvio')`.
- `tentarOp`: depois de criar (`nCodOP`), `update venda_op_vinculo set n_cod_op, estado='criada'` por `cod_int_op`; concluída → `estado='concluida'`; erro `ja_existe` (`classificarErroOmie`) → `consultarOPPorCodInt` e segue como "achou".

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/vendas/venda-idempotente.test.ts lib/vendas/local-venda.test.ts lib/omie/erros-omie.test.ts lib/estoque/ops-abertas-puro.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` limpo.

- [ ] **Step 5: Commit**

```bash
git add lib/vendas/venda-idempotente.ts lib/vendas/venda-idempotente.test.ts supabase/migrations/178_venda_omie_idempotente.sql lib/vendas-integracao.ts app/api/integracao/ordem-producao/route.ts
git commit -m "fix(vendas): OP da venda com código derivado do pedido e vínculo venda→OP (migration 178)"
```

---

### Task 10: Saída da venda sem duplicar e estorno sem depender do log podado [item 7, parte 2]

`darSaida` (`lib/vendas-integracao.ts:139-184`) sempre insere; o estorno (`lib/vendas-estorno.ts:39-47`) acha as OPs em `integration_attempts`, cujo sucesso é apagado depois de 2 dias (`app/api/cron/prune/route.ts:18`).

**Files:**
- Modify: `lib/vendas-integracao.ts:139-184,247-252`; `lib/vendas-estorno.ts:38-65`; `lib/vendas/venda-idempotente.ts` (+ teste)

**Interfaces:**
- Consumes: `chaveSaidaVenda`, `VinculoOP`, tabela `venda_op_vinculo`, coluna `movimentos.venda_chave` (Task 9).
- Produces: `darSaida(supabase, loja, codigoProduto, quantidade, local, obs, origem, marca, vendaChave: string | null)`; `type AlvoEstorno = { nCodOP: number } | { codInt: string }`; `opsParaEstornar(vinculos: VinculoOP[], legado: number[]): AlvoEstorno[]` (puro, sem repetir o mesmo `nCodOP`, ignora `estado='estornada'`).

- [ ] **Step 1: Teste que falha**

```ts
test('opsParaEstornar junta vínculo e log antigo sem repetir', () => {
  const v = [{ cod_int_op:'NTBV-a', n_cod_op:111, estado:'concluida' }, { cod_int_op:'NTBV-b', n_cod_op:null, estado:'incluindo' }, { cod_int_op:'NTBV-c', n_cod_op:333, estado:'estornada' }]
  assert.deepEqual(opsParaEstornar(v, [111, 222]), [{ nCodOP:111 }, { codInt:'NTBV-b' }, { nCodOP:222 }])
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/vendas/venda-idempotente.test.ts`
Expected: FAIL (`opsParaEstornar` inexistente).

- [ ] **Step 3: Implementar**

- `darSaida`: grava `venda_chave`; `insert` com erro `23505` → lê a linha existente por `(loja_id, venda_chave)` e devolve o status dela, sem novo envio (o cron `retry-ajustes-movimentos` cuida das que não concluíram).
- `estornarVenda`: alvos = `opsParaEstornar(vínculos do pedido, códigos dos logs de hoje como hoje)`; `{ codInt }` → `consultarOPPorCodInt` antes; depois de excluir, `estado='estornada'`. Saídas: como hoje (marca em `obs`/`obs_item`); fila: como hoje.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/vendas/venda-idempotente.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/vendas-integracao.ts lib/vendas-estorno.ts lib/vendas/venda-idempotente.ts lib/vendas/venda-idempotente.test.ts
git commit -m "fix(vendas): saída da venda idempotente e estorno pelo vínculo (não pelo log podado)"
```

- [ ] **Step 6: Prova [OK do dono: 178 + deploy; teste na loja de teste primeiro]**

Run: medir o estrago passado (só leitura): `select loja_id, obs, id_prod, count(*) from movimentos where tipo='SAI' and obs like 'Venda ntb-vendas #%' group by 1,2,3 having count(*) > 1;`. Aplicar 178 (P-MIG, sem `-1`), deploy. Na loja de teste do Sertão: mandar o mesmo pedido 2× a `/api/integracao/ordem-producao` (mesmo `pedidoRef`, itens em outra ordem na 2ª).
Expected: 1 linha por item em `venda_op_vinculo`, 1 `movimentos` por `venda_chave`, `integration_attempts` `[SIMULADO]` com 1 `IncluirOrdemProducao` por item. Em produção, depois de 3 dias: `select venda_chave, count(*) from movimentos where venda_chave is not null group by 1 having count(*) > 1` = 0 e um estorno de venda com mais de 2 dias acha as OPs.

---

### Task 11: Entrada manual com custo digitado e saída como perda (PER) (migration 179) [item 8]

Hoje a entrada vai pelo CMC lido na hora (`lib/movimentos/reenviar-manual.ts:47-48`) e todo ajuste manual vai como INV (`MOTIVO_AJUSTE_MANUAL`, `lib/actions/movimentacoes.ts:89`). A regra de 15/10 fica: linha com motivo inválido gravado continua encerrada sem reenvio.

**Files:**
- Modify: `lib/omie/motivo-ajuste.ts` (+ `.test.ts`); `lib/actions/movimentacoes.ts:24-120,307`; `lib/movimentos/reenviar-manual.ts:14-83`; `lib/actions/estoque-omie.ts:44-95`; `components/estoque-proprio/Acoes.tsx:113,151-192`; `components/movimentacoes/NovoAjusteManual.tsx`
- Create: `supabase/migrations/179_ajuste_manual_custo_informado.sql`

**Interfaces:**
- Produces (puro, em `motivo-ajuste.ts`):
  - `motivoDoAjusteManual(tipo: TipoAjusteManual, escolha?: string | null): 'INV' | 'PER'` (PER só em SAI)
  - `validarCustoInformado(v: number | null | undefined): string | null` (vazio = ok; ≤ 0 ou ≥ 1e7 = mensagem)
  - `valorDoAjusteManual(tipo: TipoAjusteManual, custoInformado: number | null | undefined, cmcAtual: number | null | undefined): { valor: number; fonte: 'informado' | 'cmc' } | { semCmc: true }`
- Produces (SQL 179): `alter table movimentos add column if not exists custo_informado numeric check (custo_informado is null or (custo_informado > 0 and custo_informado < 10000000))`.
- `criarAjusteManual(input & { custoUnitario?: number | null; motivoOmie?: 'INV' | 'PER' })`; `MovimentoManualRow` ganha `custo_informado?: number | null`; `entradaOmie(dados & { custoUnitario?: number | string | null })`; `ajusteOmie(dados & { perda?: boolean })`. Sem os campos novos = comportamento de hoje (a Central não passa nada).

- [ ] **Step 1: Testes que falham**

```ts
test('PER só na saída', () => {
  assert.equal(motivoDoAjusteManual('SAI', 'PER'), 'PER'); assert.equal(motivoDoAjusteManual('ENT', 'PER'), 'INV')
  assert.equal(motivoDoAjusteManual('SAI', undefined), 'INV'); assert.equal(motivoDoAjusteManual('SAI', 'SAI'), 'INV')
})
test('regra de 15/10 intacta: PER é enviado, SAI/ENT gravado continua encerrado', () => {
  assert.deepEqual(decidirReenvioAjusteManual({ tipo:'SAI', motivo:'PER', tentativas:0 }, 30), { acao:'enviar' })
  assert.equal(decidirReenvioAjusteManual({ tipo:'SAI', motivo:'SAI', tentativas:0 }, 30).acao, 'encerrar')
})
test('valor do ajuste: custo digitado só na entrada; sem custo segue o CMC (Central igual)', () => {
  assert.deepEqual(valorDoAjusteManual('ENT', 41.53, 27.49), { valor:41.53, fonte:'informado' })
  assert.deepEqual(valorDoAjusteManual('SAI', 41.53, 27.49), { valor:27.49, fonte:'cmc' })
  assert.deepEqual(valorDoAjusteManual('ENT', 12, 0), { valor:12, fonte:'informado' })
  assert.deepEqual(valorDoAjusteManual('ENT', undefined, 27.49), { valor:27.49, fonte:'cmc' })
  assert.deepEqual(valorDoAjusteManual('ENT', null, 0), { semCmc:true })
})
test('validarCustoInformado', () => {
  assert.equal(validarCustoInformado(undefined), null); assert.equal(validarCustoInformado(41.53), null)
  assert.ok(validarCustoInformado(0)); assert.ok(validarCustoInformado(1e7))
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/omie/motivo-ajuste.test.ts`
Expected: FAIL (funções novas inexistentes).

- [ ] **Step 3: Implementar**

- `criarAjusteManual`: valida custo; grava `motivo = motivoDoAjusteManual(tipo, input.motivoOmie)` e `custo_informado` (só ENT).
- `reenviarMovimentoManual`: `valorDoAjusteManual(mov.tipo, mov.custo_informado, …)`; com `fonte='informado'` não lê `getPosicaoProduto` (não espera CMC); `semCmc` = o "Sem CMC" de hoje.
- Retry: o `select` de `movimentacoes.ts:307` inclui `custo_informado`; nada muda em `encerrarOuEnviarAjusteManual`.
- `entradaOmie`: repassa `custoUnitario`; texto da resposta diz "pelo custo informado" ou "pelo custo médio atual".
- `ajusteOmie`: `perda=true` e delta SAI → `motivoOmie:'PER'`; delta ENT com `perda` → INV e aviso "sobra não é perda: lançada como inventário".
- Telas: entrada (Acoes.tsx e NovoAjusteManual.tsx) ganha "Custo unitário (opcional, R$)"; saída ganha a caixa "É perda ou quebra (vai como PER no Omie)".

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/omie/motivo-ajuste.test.ts lib/estoque/escrita-omie-puro.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/omie/motivo-ajuste.ts lib/omie/motivo-ajuste.test.ts supabase/migrations/179_ajuste_manual_custo_informado.sql lib/actions/movimentacoes.ts lib/movimentos/reenviar-manual.ts lib/actions/estoque-omie.ts components/estoque-proprio/Acoes.tsx components/movimentacoes/NovoAjusteManual.tsx
git commit -m "feat(movimentacoes): entrada no Omie com custo digitado e saída como perda (PER) (migration 179)"
```

- [ ] **Step 6: Prova [OK do dono: 179 + deploy; 1º lançamento real = escrita no Omie, OK para a ação]**

Run: na loja de teste da Donana PF, uma entrada com custo 41,53 e uma perda; `select request from integration_attempts where model like '[SIMULADO]%' order by id desc limit 2`.
Expected: `"valor":41.53,"motivo":"INV","tipo":"ENT"` e `"motivo":"PER","tipo":"SAI"`. Em produção (com OK), depois do sync: a linha do `kardex_omie` da entrada tem `valor_unit = 41.53` e o `cmc_apos` segue E9 `(S₀·C₀ + q·41,53)/(S₀+q)`.

---

### Task 12: Nota cancelada no estoque próprio estorna e nunca entra (migration 180) [item 9]

Hoje `sefaz_marcar_cancelada` (`139:256-271`) só avisa quando a compra já foi lançada, e um cancelamento que chega antes do XML não impede o lançamento automático (o evento acha "nota: false" e se perde).

**Files:**
- Create: `supabase/migrations/180_nf_cancelada_proprio.sql`, `scripts/testes-sql/180_nf_cancelada_proprio.sql`
- Modify: `lib/estoque/nf-sefaz.ts:89-98`, `lib/estoque/sefaz-sync.ts:65,71-77`, `lib/actions/nota-fiscal-proprio.ts:50`

**Interfaces:**
- Produces (SQL 180): tabela `sefaz_chaves_canceladas (loja_id bigint references lojas on delete cascade, chave text, recebido_em timestamptz default now(), primary key (loja_id, chave))` (RLS só leitura, initplan); `sefaz_marcar_cancelada(bigint, text)` (mesma assinatura) que sempre grava a chave e, com compra `lancada`/`parcial`, chama `estornar_compra(c.id, 'SEFAZ: nota cancelada')` e devolve `{ok, nota, nota_id, estornada: true, estornados}`; `lancar_compra(jsonb, bigint, text)` (mesma assinatura, corpo da 135) que, achada a compra, se a chave está em `sefaz_chaves_canceladas` ou a nota tem `cCancelada='S'`, chama `sefaz_marcar_cancelada` e devolve `{ok:false, compra_id, status:'cancelada', lancados:0, pendentes:0, duplicado:false, motivo:'nota cancelada na SEFAZ'}` sem lançar.

- [ ] **Step 1: Teste SQL que falha** (cópia local; loja `proprio` de teste com 1 local e 1 produto)

Cenário A: compra lançada (saldo 10) → `sefaz_marcar_cancelada` → `estornada = true`, saldo volta a 0, `compras_proprio.status='cancelada'`. Cenário B: `sefaz_marcar_cancelada` antes de existir nota → `lancar_compra` da mesma chave devolve `status='cancelada'` e 0 movimentos. Cenário C: chamar `sefaz_marcar_cancelada` de novo → `estornados = 0` (idempotente).

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL em A (`estornada` ausente) e B (lança).

- [ ] **Step 3: Implementar**

180 como em Interfaces. TS: `nf-sefaz.ts` trata `status === 'cancelada'` (não lança, não conta como erro); `sefaz-sync.ts` soma `r.estornos` quando `estornada`; `nota-fiscal-proprio.ts` responde "Nota cancelada na SEFAZ: não entra no estoque." O XML importado à mão de uma chave cancelada cai no mesmo guarda de `lancar_compra`.

- [ ] **Step 4: Rodar e ver passar**

Run: teste SQL + `node --test lib/estoque/nf-status.test.ts lib/estoque/nf-sefaz-mapa.test.ts && npx tsc --noEmit`
Expected: OK; PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/180_nf_cancelada_proprio.sql scripts/testes-sql/180_nf_cancelada_proprio.sql lib/estoque/nf-sefaz.ts lib/estoque/sefaz-sync.ts lib/actions/nota-fiscal-proprio.ts
git commit -m "fix(estoque-proprio): nota cancelada na SEFAZ estorna a entrada e não entra mais (migration 180)"
```

- [ ] **Step 6: Prova [OK do dono: 180 + deploy]**

Run (só leitura, antes e depois): `select count(*) from notas_fiscais nf join compras_proprio c on c.nota_fiscal_id = nf.id where nf.loja_id = 15 and nf.full_object->'infoCadastro'->>'cCancelada' = 'S' and c.status in ('lancada','parcial');`
Expected: antes = N (registrar; corrigir os existentes só com OK, chamando `sefaz_marcar_cancelada` por chave); depois do próximo cancelamento real, 0.

---

### Task 13: Compra manual sem duplicar (migration 181) [item 10]

`lancarCompraManual` (`lib/actions/compras-proprio.ts:120-145`) não tem chave: duplo clique dobra o estoque e cria duas notas.

**Files:**
- Create: `lib/estoque/compra-manual-puro.ts`, `lib/estoque/compra-manual-puro.test.ts`, `supabase/migrations/181_compra_manual_idempotente.sql`, `scripts/testes-sql/181_compra_manual_idempotente.sql`
- Modify: `lib/actions/compras-proprio.ts:84-145`, `components/compras-proprio/CompraManual.tsx:37`

**Interfaces:**
- Consumes: `lancar_compra` da 180 (Task 12): a 181 parte do corpo da 180, não da 135.
- Produces: `chaveIdempotenciaValida(v: unknown): string | null` (UUID, minúsculas); `compras_proprio.chave_idempotencia text` + `unique index … (loja_id, chave_idempotencia) where chave_idempotencia is not null`; `lancar_compra` que, com `p_compra->>'chave_idempotencia'` já existente na loja, devolve `{ok:true, compra_id, status, lancados:0, pendentes:0, duplicado:true}` sem tocar em nada; `lancarCompraManual(dados & { chaveIdempotencia?: string })`.

- [ ] **Step 1: Testes que falham**

```ts
test('chaveIdempotenciaValida', () => {
  assert.equal(chaveIdempotenciaValida('3F6C2A9E-1B7D-4C55-9A0E-2D8F4B6C1E07'), '3f6c2a9e-1b7d-4c55-9a0e-2d8f4b6c1e07')
  assert.equal(chaveIdempotenciaValida(''), null); assert.equal(chaveIdempotenciaValida('abc'), null); assert.equal(chaveIdempotenciaValida(42), null)
})
```
SQL: duas chamadas de `lancar_compra_com_lotes` com a mesma `chave_idempotencia` → 1 compra, movimentos 1×, 2ª com `duplicado = true`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/estoque/compra-manual-puro.test.ts` + SQL.
Expected: FAIL.

- [ ] **Step 3: Implementar**

Form: `const [chave, setChave] = useState(() => crypto.randomUUID())`, renova depois de sucesso. Action: chave inválida/ausente (desktop antigo) = segue sem chave; `duplicado` → não chama `criarNotaDaCompraManual` e devolve o `nota_fiscal_id` já gravado na compra. A fila do desktop reenvia os mesmos argumentos, então também fica protegida.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/estoque/compra-manual-puro.test.ts && npx tsc --noEmit` + SQL.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/estoque/compra-manual-puro.ts lib/estoque/compra-manual-puro.test.ts supabase/migrations/181_compra_manual_idempotente.sql scripts/testes-sql/181_compra_manual_idempotente.sql lib/actions/compras-proprio.ts components/compras-proprio/CompraManual.tsx
git commit -m "fix(compras-proprio): compra manual com chave de idempotência (migration 181)"
```

---

### Task 14: Fornecedor da nota da SEFAZ/XML vira cadastro (migration 182) [item 11]

`gravar_nota_sefaz` (`139:99`) grava `n_id_fornecedor = null`; as junções `f.codigo_omie = nf.n_id_fornecedor` (`056:16`, 036, 071) perdem essas notas. Só lojas `proprio` (a função recusa as outras).

**Files:**
- Create: `supabase/migrations/182_fornecedor_da_nota_sefaz.sql`, `scripts/testes-sql/182_fornecedor_da_nota_sefaz.sql`
- Modify: `lib/actions/fornecedor.ts:89-135,139-168` (não chamar o Omie para `origem='sefaz'`)

**Interfaces:**
- Produces (SQL 182): `create sequence seq_fornecedor_proprio start 8000000000001`; `fornecedor_da_nota_sefaz(p_loja bigint, p_cnpj text, p_razao text, p_fantasia text, p_ie text) returns bigint` (security definer; `pg_advisory_xact_lock(hashtext(p_loja || ':' || cnpj))`; CNPJ/CPF só dígitos com 11 ou 14 → acha o fornecedor mais antigo da loja com esses dígitos; sem `codigo_omie` → recebe `nextval`; não achou → insere com `origem='sefaz'`; sem CNPJ → `null`); `gravar_nota_sefaz(bigint, jsonb, jsonb)` (mesma assinatura, corpo da 139) grava `n_id_fornecedor` no insert e preenche quando está nulo no update; backfill no fim da migration: `update notas_fiscais … set n_id_fornecedor = fornecedor_da_nota_sefaz(...) where origem='sefaz' and n_id_fornecedor is null and c_cnpj_cpf is not null` (só lojas `proprio`).

- [ ] **Step 1: Teste SQL que falha**

Duas notas do mesmo CNPJ (uma com máscara `12.345.678/0001-90`, outra só dígitos) → 1 fornecedor, as duas com o mesmo `n_id_fornecedor ≥ 8000000000001`; fornecedor já cadastrado com esse CNPJ e `codigo_omie` nulo → é reaproveitado; nota sem CNPJ → `null`; `compras_ranking_fornecedores(<loja>)` devolve 1 linha para o CNPJ.

- [ ] **Step 2: Rodar e ver falhar**

Expected: FAIL (`n_id_fornecedor` nulo).

- [ ] **Step 3: Implementar** (182 como em Interfaces; `editarFornecedor`/`excluirFornecedor` salvam só local quando `origem='sefaz'`).

- [ ] **Step 4: Rodar e ver passar**

Run: teste SQL + `npx tsc --noEmit`.
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/182_fornecedor_da_nota_sefaz.sql scripts/testes-sql/182_fornecedor_da_nota_sefaz.sql lib/actions/fornecedor.ts
git commit -m "feat(estoque-proprio): fornecedor da nota da SEFAZ/XML vira cadastro (migration 182)"
```

- [ ] **Step 6: Prova [OK do dono: 182 com backfill = escrita em dado de produção; deploy]**

Run (só leitura, antes e depois): `select count(*) filter (where n_id_fornecedor is null) as sem_fornecedor, count(*) from notas_fiscais where loja_id = 15 and origem = 'sefaz' and c_cnpj_cpf is not null;`
Expected: depois, `sem_fornecedor = 0`; o ranking de fornecedores da ODARA sem linha "(sem nome)" para essas notas.

---

### Task 15: Bugs menores do item 12 (migration 183)

Três correções pequenas e independentes, num commit cada.

**Files:**
- Modify: `lib/faturamento-periodo.ts` (+ `.test.ts`), `app/(app)/relatorio-producao/page.tsx:126`
- Create: `supabase/migrations/183_lucro_repor_paginacao.sql`
- Modify: `app/(app)/relatorio-lucro/dados.ts:37-43`, `app/(app)/home/page.tsx:122`, `app/(app)/produto/page.tsx:131`, `AGENTS.md` (registro desta fase + Task 3)

**Interfaces:**
- Produces: `ultimoDiaDoMes(mes: string): string` (`'YYYY-MM'` → `'YYYY-MM-DD'`); `lucro_proprio(bigint,date,date,text)` com `order by 4 desc nulls last, 1` (único ponto que muda em relação à 150); `produtos_repor(bigint)` com `and coalesce(p.inativo, 'N') <> 'S'`, `order by p.codigo_produto` e `revoke execute … from anon`.

- [ ] **Step 1: Teste que falha**

```ts
test('ultimoDiaDoMes', () => {
  assert.equal(ultimoDiaDoMes('2026-09'), '2026-09-30'); assert.equal(ultimoDiaDoMes('2026-02'), '2026-02-28')
  assert.equal(ultimoDiaDoMes('2028-02'), '2028-02-29'); assert.equal(ultimoDiaDoMes('2026-12'), '2026-12-31')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/faturamento-periodo.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

- Produção: `p_fim: ultimoDiaDoMes(mes)` (hoje `'2026-09-31'` faz o Postgres recusar a data e a seção "Previsto × produzido" cai no aviso de erro em 7 dos 12 meses).
- Lucro: `rpcTodos` (`lib/supabase/rpc-todos.ts`) nas duas chamadas de `lucro_proprio`; vendas por `buscarTodasLinhas` com `.select('id, valor')…order('id')` (o `.limit(50000)` de hoje para em 1.000 no PostgREST: contagem de vendas e ticket médio errados acima de 1.000 vendas no período).
- `produtos_repor`: `rpcTodos` em `home` e `produto`; no `produto`, o filtro "Só repor" usa `buscarTodosPorIds` (lista grande estoura a URL, 414).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/faturamento-periodo.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commits**

```bash
git add lib/faturamento-periodo.ts lib/faturamento-periodo.test.ts "app/(app)/relatorio-producao/page.tsx"
git commit -m "fix(producao): fim do mês certo no previsto × produzido"
git add supabase/migrations/183_lucro_repor_paginacao.sql "app/(app)/relatorio-lucro/dados.ts" "app/(app)/home/page.tsx" "app/(app)/produto/page.tsx"
git commit -m "fix(relatorios): Lucro e produtos a repor sem o corte de 1.000 linhas; repor sem inativos (migration 183)"
git add AGENTS.md
git commit -m "docs: Fase A da paridade com o Omie no AGENTS.md"
```

- [ ] **Step 6: Prova [OK do dono: 183 + deploy]**

Run (só leitura): `select count(*) from relatorio_op_previsto_produzido(5,'2026-09-01','2026-09-30');` (antes dava erro); `select count(*) from produtos_repor(5);` = número do card da home; `select count(*) from produtos_repor(5) r join produtos p on p.loja_id = 5 and p.codigo_produto = r where p.inativo = 'S'` = 0; `/relatorio-lucro` da loja 15: linhas e nº de vendas = `count(*)` direto no SQL do período.
Expected: tudo igual ao SQL.

---

## Ordem de execução e portões

Legenda: **[OK]** = precisa do OK explícito do dono no chat antes de executar aquele passo. Todo deploy, toda migration em produção e toda escrita no Omie de produção é **[OK]**, sem exceção. Leitura (SQL só leitura, `\df`, relatórios do Omie) não precisa.

| Lote | Tasks | Portões [OK] | Observação |
|---|---|---|---|
| 0 | 3 (`SUPABASE_DB_URL`) | trocar o `.env.local` do servidor | Primeiro de tudo: qualquer script lá pode estar mexendo no banco errado. Passos 1–2 são só leitura. |
| 1 | 1 (itens 1–3) | migration 173; migration 174; merge + deploy | Código já pronto. |
| 2 | 2 (item 4) | `update lojas set espelho_completo = true` (loja 5) | Só depois de a faxina do Mac terminar; fora de 00–07 h Bahia; parar no 1º `MISUSE_API_PROCESS`. |
| 3 | 4 → 5 → 6 → 7 → 8 (itens 5 e 6) | migrations 175, 176, 177; merge + deploy; versão do desktop | Prova da Task 8 depende do Lote 2 para outubro. Os números de Compras caem ~3–4 % (agora iguais ao Omie): avisar o dono antes. |
| 4 | 9 → 10 (item 7) | migration 178 (sem `-1`); merge + deploy | Mexe no fluxo de venda ao vivo (lojas 4 e 5): testar antes na loja de teste do Sertão; deploy fora do horário de pico. |
| 5 | 11 (item 8) | migration 179; merge + deploy; **1ª entrada com custo e 1ª perda reais no Omie** | Primeiro na loja de teste da Donana PF (simulado). |
| 6 | 12 → 13 → 14 (itens 9–11, ODARA) | migrations 180, 181, 182 (a 182 faz backfill em dado de produção); merge + deploy; correção das compras canceladas já lançadas (se houver) | 181 depende do corpo de `lancar_compra` da 180. |
| 7 | 15 (item 12) | migration 183; merge + deploy | Independente; pode ir junto com qualquer lote depois do 1. |

Dentro de cada lote: implementar e testar todas as tasks (sem produção) → pedir o OK mostrando os testes e o que vai mudar → P-MIG de cada migration na ordem numérica → deploy → P-PROVA. Falhou uma prova: parar o lote, não seguir para o próximo.
