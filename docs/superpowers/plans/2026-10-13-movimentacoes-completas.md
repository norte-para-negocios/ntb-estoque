# Movimentações completas, OP/NF ligadas e velocidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na loja Omie, a tela de Movimentações traz TODOS os movimentos do período/produto/OP com filtros e link para o documento de origem; OP ganha barra de pesquisa e mostra os movimentos que gerou; nota fiscal liga itens a produto e movimentos; as telas principais ficam abaixo de 1 s no servidor.

**Architecture:** Duas fontes atrás de um loader único (`lib/movimentacoes/dados.ts`): loja com `espelho_completo` lê `kardex_omie` (o kardex do próprio Omie, completo); as demais leem a RPC nova `movimentacoes_loja` (migration 170), que junta numa consulta só ajustes/PDV/contagens/transferências (`movimentos`), produção e consumo das OPs concluídas (`ordens_producao` + ficha gravada na OP) e entradas de NF concluídas — com aviso de que é uma reconstrução. Regras de URL, origem, documento e casamento OP×kardex ficam num módulo puro testado com `node --test`. Velocidade: RLS "initplan" nas tabelas que ficaram de fora da 156 (a principal é `movimentos_historico`: 2,07 s → 0,19 s na RPC do relatório), índices que faltam (`movimentos` por produto, `ordens_producao` por data), páginas paralelas e menos idas ao banco.

**Tech Stack:** Next.js (App Router, server components), Supabase/PostgREST, Postgres 17, TypeScript, `node --test`.

**Spec:** pedido do dono (13/10, resumido no brief desta tarefa) + `docs/superpowers/specs/2026-10-13-nosso-omie-design.md` (Fase 2 "kardex da loja", regras transversais §3).

## Diagnóstico (medido em produção, só SELECT, 13/10/2026)

1. **Aba Movimentos só mostra uma reconstrução parcial e exige produto.** Sem produto: "Selecione um produto". Com produto: junta `movimentos` (ajustes/PDV/contagem, `.limit(500)`), OPs **do próprio produto** (só a entrada, filtradas pela data PREVISTA), itens de NF (`.limit(500)` SEM filtro de data — corta arbitrariamente quem tem muitas notas) e inventários (`.limit(200)` sem data). Período padrão = só hoje.
   - O **consumo de insumos nas OPs não aparece nunca.** Loja 5, 13/09–13/10: LEITE DE COCO (MP) tem 1.058.182 de saída no Omie (`movimentos_historico`) e a aba mostra 3 linhas (contagens) com 0 de saída; o mesmo para VINAGRE, MARGARINA, LEITE COND., VINHO, CREME DE LEITE (todos MP: só saem por OP).
   - Produto 2976363339 tem 2.005 linhas em `movimentos` em 30 dias → `.limit(500)` corta 75%. Produto 2883267156 tem 866 itens de NF → o `.limit(500)` sem data escolhe 500 quaisquer.
   - Item de NF de entrada entra como **"Saída"** (`tipo: 'SAI'`) — sinal trocado.
   - `kardex_omie` (fonte completa) existe mas está vazia em produção (migrations 160/161 ainda não aplicadas; o cron enche só a loja 5).
2. **Aba Histórico** (`movimentos_historico`, agregado por produto/dia, sem local, valor nem documento): filtro de tipo/família lê `produtos` sem paginar (corta em 1000; lojas têm 2.300–2.900 produtos); filtro de local lê `posicao_estoques` sem paginar (2.717 produtos num local da loja 5, várias fotos) e depois faz `.in('cod_prod', centenas)` → risco de 414 que vira "nenhum resultado"; totais do modo "por data" usam `.limit(100000)` mas o PostgREST corta em 1000 → total errado. Ainda completa com o Contabo frio, desnecessário desde o backfill de 08/10.
3. **Lentidão:** a política de RLS de `movimentos_historico` (e de `lojas`, `vendas_proprio_itens`, `vendas_proprio_pagamentos`, `ordens_producao_proprio_itens`) ficou fora da 156 (tem um cast `::bigint`/subconsulta e o `DO` da 156 casava a expressão exata) — chama 2 funções por linha. Como usuário logado: RPC `relatorio_movimentacao_matriz` (loja 3, ano) **2.072 ms** vs 189 ms sem RLS; leitura de 30 dias do histórico 155 ms vs 30 ms. `pg_stat_statements`: a leitura do Histórico tem média de 1.737 ms. `movimentos` não tem índice por produto (172 ms por consulta mesmo sem RLS, 146 MB); `ordens_producao` não tem índice por data prevista (lista 510 ms, cada contador 150 ms × 4).
4. Tempos medidos ANTES (servidor, conta QA logada, loja 3, mediana de 3): início 0,95 s · estoque 1,17 · movimentações 1,42 · movimentos com produto (30 dias) **4,06 s / 12 MB de HTML** · OPs 1,05 · OP 0,46 · NFs 0,75 · NF 0,72 · produto 0,99 · faturamento 0,97 · relatório de movimentação **6,10 s** · produtos 1,36.

## Global Constraints

- Trabalhar só em `/Users/joaquimsalles/Projects/ntb-estoque-movimentacoes` (branch `movimentacoes-completas`, base `nosso-omie`).
- Não tocar nos arquivos da Fase 4: `app/(app)/estoque/page.tsx`, `ordem-producao/abertas/page.tsx`, `estoque/fichas/page.tsx`, `estoque/ajustes/page.tsx`, `estoque/dados-saude.ts`, `lib/estoque/saude-puro.ts`, `lib/omie/{ajuste,malha,fichas}.ts`, `components/estoque-proprio/Acoes.tsx`, `lib/permissoes-catalogo.ts`, `lib/offline/*`. Exceção mínima (Ruling R7): uma linha em `estoque/produto/[codigo]/page.tsx`.
- Migrations a partir de **170**, manuais, NÃO aplicar. Sem deploy, sem push, sem chamar o Omie, sem escrita em produção.
- `.range()` sempre com `.order(<coluna única>)`; lista de ids grande nunca em `.in()` na URL (RPC por POST ou lotes de 150); `lojas` sempre com `is_test` quando for usada para Omie.
- Testes puros sem `@/` (import relativo com `.ts`), `node --test`; `npx tsc --noEmit`; `npm run build`.
- Textos em português simples; kit visual atual (`components/ui-kit`).
- Server action nova → `node scripts/inserir-via-desktop.mjs` (este plano não cria nenhuma). Migration nova → `desktop/scripts/gerar-schema.sh` depois de aplicada (passo de deploy).

## Rulings

- R1. Fonte: `espelho_completo` → `kardex_omie`; senão RPC `movimentacoes_loja` com aviso "lista montada a partir de ajustes, vendas, OPs e notas; o kardex completo do Omie chega quando o espelho completo for ligado".
- R2. Filtro de origem no modo kardex usa o código do próprio Omie (`cod_origem`, rótulo `des_origem`), porque os códigos reais ainda não foram vistos em produção; a categoria (PDV, OP, NF, ajuste, transferência, inventário) aparece em cada linha por `origemDoKardex`. No modo reconstruído o filtro é a categoria.
- R3. Período: padrão últimos 7 dias; máximo 366 dias no kardex ou quando há produto/documento no filtro; 92 dias na reconstrução sem produto/documento.
- R4. Contagem de inventário (`SLD`) aparece como "Contagem: X" (não é movimento assinado, AGENTS.md "trap do SLD") e não entra nos totais.
- R5. Item de NF entra com `n_qtde_nfe` na unidade da nota (o Omie converte na entrada; `quantidade` está nula em 20.115 de 20.122 itens da loja 5) e na data de emissão; só nota concluída e não cancelada.
- R6. OP: entrada = `identificacao_n_qtde` na data `dt_conclusao_real`, local da OP; consumo = `full_object.itensDetalhes[].nQtde` (cUtilizarDoEstoque ≠ 'N'), local do item (ou da OP). OP sem ficha gravada: só a entrada, com aviso.
- R7. Página do produto da loja Omie é `/estoque/produto/[codigo]` (arquivo da Fase 4): só uma linha (`<NotasDoProduto … />`) e um import; o resto num componente novo.
- R8. Kardex × OP: casa por número do documento (`num_doc`/`num_pedido` ≈ número da OP, código do Omie ou código de integração); sem nenhum casamento por documento, cai em data (±1 dia da conclusão) + produto da OP/insumo + origem de OP, marcado "provável".
- R9. Cupom: página nova `/faturamento/cupom/[id]` (mesmo controle de acesso de `/faturamento`), lê o cupom do Contabo (`buscarFatCupomDetalhe`).
- R10. Tempo DEPOIS medido no servidor numa instância temporária do build deste branch (porta 3019, só 127.0.0.1, encerrada em seguida — não é deploy) contra o banco de produção sem as migrations; o ganho das migrations é medido em cópia local (Postgres 17 em Docker, esquema de produção + dados da loja 5) como usuário `authenticated`.
- R11. Medição com a conta QA na loja 3 (loja atual dela; trocar de loja seria escrita em `profiles`).

## Review Focus

1. Busca de produto que casa centenas de produtos (ex.: "a") → no máximo 300 ids, aviso de refinar, nunca 414/"nenhum resultado" — teste de `lerFiltrosMovimentacoes` + `MAX_IDS` no loader (RPC por POST).
2. Período invertido, data inválida ou maior que o máximo → troca/corta e avisa — teste de `lerFiltrosMovimentacoes`.
3. Número de OP digitado sem o ano/zeros ("396850") ou data "13/10" na busca de OP → acha a OP — testes de `interpretarBuscaOP` e `numerosCandidatos`.
4. OP cujo kardex não traz número de documento → movimentos por data+produto marcados "provável", nunca vazio silencioso — teste de `casarKardexComOP`.
5. NF de entrada mostrada como entrada (sinal +) e contagem de inventário fora dos totais — testes da RPC na cópia local (Task 3) e de `totaisDe` (Task 2).

---

## File Structure

- Create `lib/movimentacoes/movimentacoes-puro.ts` (+ `.test.ts`): filtros da URL, origem do kardex, documento → link, números de OP/NF, busca de OP, casamento kardex×OP, movimentos previstos da OP, totais.
- Create `supabase/migrations/170_movimentacoes_completas.sql`: RLS initplan das 5 tabelas restantes, índices, RPC `movimentacoes_loja`.
- Create `lib/movimentacoes/dados.ts`: `carregarMovimentacoes`, `resolverDocumentosKardex`, `movimentosDaOP`, `movimentosDaNota`.
- Modify `app/(app)/estoque/dados-kardex.ts`: filtro `doc` em `buscarKardexLoja`; `FiltrosKardexLoja` ganha `doc` (`lib/estoque/kardex-loja-puro.ts`).
- Create `components/movimentacoes/MovimentosOmie.tsx` (server) + `TabelaMovimentos.tsx`; modify `components/movimentacoes/MovimentosTab.tsx` (vira só a saída para `MovimentosOmie`), `app/(app)/movimentacoes/page.tsx`.
- Modify `components/movimentacoes/HistoricoTab.tsx` (sem truncar, sem frio, páginas paralelas).
- Create `app/(app)/faturamento/cupom/[id]/page.tsx`.
- Modify `app/(app)/ordem-producao/page.tsx` (barra de pesquisa `q`, famílias pela tabela `familias`), create `components/ordem-producao/BuscaOP.tsx`.
- Modify `app/(app)/ordem-producao/[id]/page.tsx` + create `components/ordem-producao/MovimentosDaOP.tsx`.
- Modify `app/(app)/nota-fiscal/[id]/page.tsx`, `components/nota-fiscal/ItensNotaFiscal.tsx`; create `components/nota-fiscal/MovimentosDaNota.tsx`, `components/estoque-proprio/NotasDoProduto.tsx`; 1 linha em `app/(app)/estoque/produto/[codigo]/page.tsx`.
- Modify `app/(app)/relatorio-movimentacao/page.tsx` (+ `export/route.ts` se usar o mesmo laço): páginas da RPC em paralelo.
- Modify `AGENTS.md` (seção nova).

---

### Task 1: Regras puras das movimentações

**Files:** Create `lib/movimentacoes/movimentacoes-puro.ts`, `lib/movimentacoes/movimentacoes-puro.test.ts`

**Interfaces (Produces):**
```ts
export type OrigemMov = 'pdv' | 'op_producao' | 'op_consumo' | 'nf' | 'transferencia' | 'inventario' | 'ajuste' | 'outro'
export const ROTULO_ORIGEM_MOV: Record<OrigemMov, string>
export const OPCOES_ORIGEM_MOV: { value: OrigemMov; label: string }[]
export type DocMov = { tipo: 'op' | 'nf' | 'cupom' | 'ajuste' | 'transferencia' | 'inventario'; id: number | null; rotulo: string; dia?: string | null; produto?: string | null }
export type FiltrosMov = { ini: string; fim: string; q: string; produto: number | null; local: number | null; origem: string; doc: string; autor: string; page: number; erro: string | null }
export const MAX_DIAS_AMPLO = 366, MAX_DIAS_RECONSTRUIDO = 92, PADRAO_DIAS = 7
export function lerFiltrosMovimentacoes(sp: Record<string, string | undefined>, hoje: string, reconstruido: boolean): FiltrosMov
export function origemDoKardex(l: { cod_origem: string | null; des_origem: string | null; quantidade: number; id_cupom: number | null; id_ajuste: number | null }): OrigemMov
export function hrefDocumento(d: DocMov): string | null
export function numerosCandidatos(...valores: (string | number | null | undefined)[]): string[]
export function interpretarBuscaOP(q: string, hoje: string): { texto: string; data: string | null; numero: string | null }
export type OPMin = { id: number; identificacao_n_cod_op: number | null; identificacao_c_num_op: string | null; identificacao_c_cod_int_op: string | null; identificacao_n_cod_produto: number | null; identificacao_n_qtde: number | null; identificacao_codigo_local_estoque: number | null; dt_conclusao_real: string | null; concluida: boolean | null }
export type ItemFichaOP = { nIdProdutoMalha: number; nQtde: number; codigo_local_estoque?: number | string | null; cUtilizarDoEstoque?: string | null }
export type MovPrevisto = { n_cod_prod: number; local: number | null; quantidade: number; origem: 'op_producao' | 'op_consumo' }
export function movimentosPrevistosDaOP(op: OPMin, itens: ItemFichaOP[]): MovPrevisto[]
export type KardexMin = { n_cod_prod: number; data_mov: string; cod_origem: string | null; des_origem: string | null; quantidade: number; num_doc: string | null; num_pedido: string | null; id_cupom: number | null; id_ajuste: number | null }
export function casarKardexComOP<T extends KardexMin>(linhas: T[], op: OPMin, produtosDaOP: number[]): { linhas: (T & { provavel: boolean })[]; criterio: 'documento' | 'data' | 'nenhum' }
export function totaisDe(linhas: { quantidade: number; contagem?: boolean; cancelado?: boolean }[]): { entradas: number; saidas: number }
```

- [ ] **Step 1: Write the failing tests** (`lib/movimentacoes/movimentacoes-puro.test.ts`)

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerFiltrosMovimentacoes, origemDoKardex, hrefDocumento, numerosCandidatos, interpretarBuscaOP, movimentosPrevistosDaOP, casarKardexComOP, totaisDe, type OPMin } from './movimentacoes-puro.ts'

const HOJE = '2026-10-13'
test('filtros: padrão 7 dias, invertido troca, limite por modo', () => {
  assert.deepEqual([lerFiltrosMovimentacoes({}, HOJE, false).ini, lerFiltrosMovimentacoes({}, HOJE, false).fim], ['2026-10-07', '2026-10-13'])
  const inv = lerFiltrosMovimentacoes({ data_inicio: '2026-10-10', data_final: '2026-10-01' }, HOJE, false)
  assert.deepEqual([inv.ini, inv.fim], ['2026-10-01', '2026-10-10'])
  const longo = lerFiltrosMovimentacoes({ data_inicio: '2025-01-01', data_final: '2026-10-13' }, HOJE, true)
  assert.equal(longo.ini, '2026-07-14'); assert.match(longo.erro ?? '', /92 dias/)
  const comProduto = lerFiltrosMovimentacoes({ data_inicio: '2025-01-01', q: 'leite' }, HOJE, true)
  assert.equal(comProduto.ini, '2025-10-13'); assert.match(comProduto.erro ?? '', /366 dias/)
  assert.equal(lerFiltrosMovimentacoes({ data_inicio: 'xx', page: '-3', local: '12a' }, HOJE, false).page, 1)
  assert.equal(lerFiltrosMovimentacoes({ local: '12a' }, HOJE, false).local, null)
})
test('origem do kardex', () => {
  const b = { des_origem: null, quantidade: -1, id_cupom: null, id_ajuste: null }
  assert.equal(origemDoKardex({ ...b, cod_origem: 'PDV', id_cupom: 9 }), 'pdv')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'OPS' }), 'op_consumo')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'OPE', quantidade: 2 }), 'op_producao')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'COM', quantidade: 5 }), 'nf')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'TRF' }), 'transferencia')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'SLD' }), 'inventario')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'AJU', id_ajuste: 3 }), 'ajuste')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'XYZ', des_origem: 'Ordem de Produção' }), 'op_consumo')
  assert.equal(origemDoKardex({ ...b, cod_origem: 'XYZ' }), 'outro')
})
test('link do documento', () => {
  assert.equal(hrefDocumento({ tipo: 'op', id: 7, rotulo: 'OP 1' }), '/ordem-producao/7')
  assert.equal(hrefDocumento({ tipo: 'nf', id: 8, rotulo: 'NF 2' }), '/nota-fiscal/8')
  assert.equal(hrefDocumento({ tipo: 'cupom', id: 9, rotulo: 'Cupom' }), '/faturamento/cupom/9')
  assert.equal(hrefDocumento({ tipo: 'transferencia', id: 4, rotulo: 'T' }), '/transferencia/4')
  assert.equal(hrefDocumento({ tipo: 'inventario', id: 5, rotulo: 'I' }), '/inventario/5')
  assert.equal(hrefDocumento({ tipo: 'ajuste', id: 6, rotulo: 'A', dia: '2026-10-01', produto: '701' }), '/estoque/ajustes?data_inicio=2026-10-01&data_final=2026-10-01&q=701')
  assert.equal(hrefDocumento({ tipo: 'op', id: null, rotulo: 'OP ?' }), null)
})
test('números candidatos (OP/NF) ignoram ano, barra e zeros', () => {
  assert.deepEqual(numerosCandidatos('2026/00396850'), ['2026/00396850', '396850', '202600396850'])
  assert.ok(numerosCandidatos('000123').includes('123'))
  assert.deepEqual(numerosCandidatos(null, '', undefined), [])
})
test('busca de OP: número, data e texto', () => {
  assert.deepEqual(interpretarBuscaOP('396850', HOJE), { texto: '396850', data: null, numero: '396850' })
  assert.deepEqual(interpretarBuscaOP('13/10', HOJE), { texto: '', data: '2026-10-13', numero: null })
  assert.deepEqual(interpretarBuscaOP('01/12/2025', HOJE), { texto: '', data: '2025-12-01', numero: null })
  assert.deepEqual(interpretarBuscaOP('  cupom 55 ', HOJE), { texto: 'cupom 55', data: null, numero: null })
  assert.deepEqual(interpretarBuscaOP('2026/00396850', HOJE), { texto: '2026/00396850', data: null, numero: '2026/00396850' })
})
const OP: OPMin = { id: 1, identificacao_n_cod_op: 555, identificacao_c_num_op: '2026/00000042', identificacao_c_cod_int_op: 'X1', identificacao_n_cod_produto: 10, identificacao_n_qtde: 2, identificacao_codigo_local_estoque: 100, dt_conclusao_real: '2026-10-10', concluida: true }
test('movimentos previstos da OP: entrada + consumo (sem os que não usam estoque)', () => {
  const r = movimentosPrevistosDaOP(OP, [{ nIdProdutoMalha: 20, nQtde: 0.5, codigo_local_estoque: '200' }, { nIdProdutoMalha: 21, nQtde: 1 }, { nIdProdutoMalha: 22, nQtde: 3, cUtilizarDoEstoque: 'N' }])
  assert.deepEqual(r, [
    { n_cod_prod: 10, local: 100, quantidade: 2, origem: 'op_producao' },
    { n_cod_prod: 20, local: 200, quantidade: -0.5, origem: 'op_consumo' },
    { n_cod_prod: 21, local: 100, quantidade: -1, origem: 'op_consumo' },
  ])
  assert.deepEqual(movimentosPrevistosDaOP({ ...OP, concluida: false, dt_conclusao_real: null }, []), [])
})
test('kardex × OP: documento primeiro, senão data+produto (provável)', () => {
  const k = (o: Partial<Parameters<typeof casarKardexComOP>[0][number]>) => ({ n_cod_prod: 10, data_mov: '2026-10-10', cod_origem: 'OPE', des_origem: null, quantidade: 2, num_doc: null, num_pedido: null, id_cupom: null, id_ajuste: null, ...o })
  const porDoc = casarKardexComOP([k({ num_doc: '42' }), k({ num_doc: '43' }), k({ n_cod_prod: 20, quantidade: -0.5, cod_origem: 'OPS', num_doc: '2026/00000042' })], OP, [10, 20])
  assert.equal(porDoc.criterio, 'documento'); assert.equal(porDoc.linhas.length, 2); assert.ok(porDoc.linhas.every((l) => !l.provavel))
  const porData = casarKardexComOP([k({}), k({ data_mov: '2026-10-11', n_cod_prod: 20, cod_origem: 'OPS', quantidade: -1 }), k({ data_mov: '2026-10-15' }), k({ n_cod_prod: 99 }), k({ cod_origem: 'PDV' })], OP, [10, 20])
  assert.equal(porData.criterio, 'data'); assert.equal(porData.linhas.length, 2); assert.ok(porData.linhas.every((l) => l.provavel))
  assert.equal(casarKardexComOP([], OP, [10]).criterio, 'nenhum')
})
test('totais: contagem e cancelado fora', () => {
  assert.deepEqual(totaisDe([{ quantidade: 5 }, { quantidade: -2 }, { quantidade: 9, contagem: true }, { quantidade: -4, cancelado: true }]), { entradas: 5, saidas: 2 })
})
```

- [ ] **Step 2: Run** `node --test lib/movimentacoes/movimentacoes-puro.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implement** `lib/movimentacoes/movimentacoes-puro.ts` (sem imports; regex de origem: PDV/VEN/cupom/NFC → pdv; `^OP`/produ → produção se quantidade > 0 senão consumo; COM/NFE/compra/receb/nota → nf; TRF/transf → transferencia; SLD/invent/contagem → inventario; AJU/ajuste ou id_ajuste → ajuste; id_cupom → pdv).
- [ ] **Step 4: Run** the tests → PASS. `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(movimentacoes): regras puras (filtros, origem, documento, OP x kardex)`.

### Task 2: Migration 170 — RLS initplan, índices e RPC `movimentacoes_loja`

**Files:** Create `supabase/migrations/170_movimentacoes_completas.sql`; harness local (scratchpad, fora do repo): `docker run postgres:17`, esquema `pg_dump --schema-only` da produção, dados da loja 5 (30 dias) copiados por `\copy (select …) to stdout`.

**Interfaces (Produces):**
```sql
movimentacoes_loja(p_loja_id bigint, p_ini date, p_fim date, p_produtos bigint[] default null, p_local bigint default null,
  p_origem text default null, p_doc text default null, p_autor text default null, p_limit int default 100, p_offset int default 0)
returns table (chave text, data date, momento timestamptz, n_cod_prod bigint, codigo_local_estoque bigint, local_destino bigint,
  quantidade numeric, contagem boolean, origem text, doc_tipo text, doc_id bigint, doc_rotulo text, autor text, obs text,
  total bigint, entradas numeric, saidas numeric)
-- security invoker (RLS do usuário vale), stable, search_path=public; grant execute to authenticated.
```
Fontes (union all): `movimentos` (dia = data UTC se meia-noite UTC exata, senão dia da Bahia; ENT +|q|, SAI −|q|, TRF/TPQ −|q| com destino, SLD contagem; origem pdv/inventario/transferencia/ajuste; doc transferência → `transferencia_id`, SLD → `inventario_items.inventario_id` por `id_ajuste`, demais → ajuste `id_ajuste`; autor `m.autor`); OP concluída por `dt_conclusao_real` (+`identificacao_n_qtde` no local da OP, doc op/id/número); consumo `jsonb_array_elements(full_object->'itensDetalhes')` com `cUtilizarDoEstoque` ≠ 'N' (−nQtde, local do item senão da OP); NF (`notas_fiscais` concluída `c_etapa='60'`, `deleted_at is null`, `cCancelada` ≠ 'S', +`n_qtde_nfe`, local de `full_object->itensAjustes->>codigo_local_estoque`, doc nf/id/número). Filtros aplicados depois do union; `total`, `entradas`, `saidas` por janela (`over ()`), contagem fora dos totais; ordem `data desc, momento desc, chave`.

Índices (`create index concurrently if not exists`, fora de transação): `movimentos (loja_id, id_prod, data desc)`, `ordens_producao (loja_id, identificacao_d_dt_previsao)`, `ordens_producao (loja_id, dt_conclusao_real) where concluida`, `ordens_producao using gin (identificacao_c_num_op gin_trgm_ops)`, `nota_fiscal_items (loja_id, n_id_produto)`, `inventario_items (loja_id, id_ajuste) where id_ajuste is not null`.

RLS: `movimentos_historico` e `lojas` (`id in (select usuario_lojas())`) para `((select usuario_e_admin()) or … in (select usuario_lojas()))`; as 3 tabelas filhas (`vendas_proprio_itens`, `vendas_proprio_pagamentos`, `ordens_producao_proprio_itens`) com o mesmo padrão dentro do `exists`.

- [ ] **Step 1:** Subir a cópia local, aplicar 159/160/161 e escrever um teste SQL (`scratchpad/teste-170.sql`) que confere, para a loja 5 em 30 dias: soma de saídas de OP consumo por produto = soma de `itensDetalhes` das OPs concluídas no período; NF com quantidade > 0; contagem fora dos totais; filtro de produto/local/origem/doc/autor; `total` = count do union filtrado. Rodar → FAIL (função não existe).
- [ ] **Step 2:** Escrever a migration.
- [ ] **Step 3:** Aplicar na cópia local, rodar o teste → PASS; medir como `authenticated` (antes/depois da RLS: RPC do relatório, histórico 30 dias; RPC nova 7 e 30 dias; consulta de `movimentos` por produto).
- [ ] **Step 4: Commit** `feat(db): migration 170 (RLS initplan restante, indices, RPC movimentacoes_loja)`.

### Task 3: Loader das movimentações (kardex ou reconstrução) com documento resolvido

**Files:** Create `lib/movimentacoes/dados.ts`; modify `lib/estoque/kardex-loja-puro.ts` (campo `doc` em `FiltrosKardexLoja`, lido de `sp.doc`), `app/(app)/estoque/dados-kardex.ts` (filtro `doc`: `or(num_doc.ilike.%d%,num_pedido.ilike.%d%)`).

**Interfaces:**
- Consumes: Task 1 (`FiltrosMov`, `origemDoKardex`, `numerosCandidatos`, `DocMov`, `totaisDe`), Task 2 (RPC), `buscarKardexLoja`, `lojaEspelho`, `historicoKardexDesde`, `emLotes`.
- Produces:
```ts
export type LinhaMov = { chave: string; data: string; n_cod_prod: number; produto: string; codigo: string; unidade: string; local: string; localDestino: string | null; quantidade: number; contagem: boolean; origem: OrigemMov; origemRotulo: string; doc: DocMov | null; autor: string | null; saldoApos: number | null; cmcApos: number | null; valorUnit: number | null; cancelado: boolean; provavel?: boolean }
export type ResultadoMov = { fonte: 'kardex' | 'reconstruido'; linhas: LinhaMov[]; total: number; entradas: number | null; saidas: number | null; avisos: string[]; erro: string | null; historicoDesde: string | null }
export async function carregarMovimentacoes(lojaId: number, sp: Record<string, string | undefined>, hoje: string, porPagina: number): Promise<{ filtros: FiltrosMov; res: ResultadoMov; origens: { value: string; label: string }[] }>
export async function resolverDocumentosKardex(lojaId: number, linhas: LinhaKardexLoja[]): Promise<Map<number, DocMov>>  // chave = LinhaKardexLoja.id
```
- [ ] **Step 1:** `kardex-loja-puro.test.ts`: acrescentar teste `lerFiltrosKardex({ doc: ' 123 ' }).doc === '123'` → FAIL → implementar → PASS.
- [ ] **Step 2:** Implementar `dados.ts`: produtos do texto (até 300 ids, `.order('id')`, aviso se cortou), RPC por `supabase.rpc('movimentacoes_loja', …)` (POST: lista grande não vai na URL), enriquecimento (produtos/locais em lotes de 150), documentos do kardex: OP por `identificacao_c_num_op in (candidatos)` ou `identificacao_n_cod_op`, NF por `c_numero_nfe` em candidatos e que tenha item do produto da linha, cupom = `id_cupom`, ajuste → `movimentos` (`transferencia_id`) → `inventario_items` (`inventario_id`) → ajuste.
- [ ] **Step 3:** `npx tsc --noEmit` → limpo. **Commit** `feat(movimentacoes): loader unico (kardex do Omie ou reconstrucao) com documento de origem`.

### Task 4: Tela de Movimentações (aba Movimentos) e página do cupom

**Files:** Create `components/movimentacoes/MovimentosOmie.tsx`, `components/movimentacoes/TabelaMovimentos.tsx`, `app/(app)/faturamento/cupom/[id]/page.tsx`; modify `components/movimentacoes/MovimentosTab.tsx`, `app/(app)/movimentacoes/page.tsx`.

- [ ] **Step 1:** `MovimentosOmie` (server): `carregarMovimentacoes`; cabeçalho com fonte/aviso, "N movimentos de dd/mm a dd/mm", totais (reconstrução); `Filtros` (data_inicio, data_final, q = produto, local, origem, doc, autor); `TabelaMovimentos`; `Paginacao` com total; `NovoAjusteManual` quando o filtro achou um único produto e há permissão (mantém o que existia).
- [ ] **Step 2:** `TabelaMovimentos` (server, tabela como a do `/estoque/kardex`): Data, Produto (link `/estoque/produto/<cod>` + link "só este" que filtra `produto=`), Local (→ destino), Origem (rótulo), Documento (link `hrefDocumento`, "provável" quando for o caso), Quantidade (+/−, "Contagem: X"), Custo/Saldo após (só kardex), Quem lançou.
- [ ] **Step 3:** `MovimentosTab` passa a só renderizar `MovimentosOmie` (o código antigo de reconstrução por produto sai — substituído pela RPC); `page.tsx` (aba movimentos) não exige mais produto. Descrição da página sem "(2026)".
- [ ] **Step 4:** Página do cupom: cabeçalho (número, data, valor, situação), itens (link para o produto) e pagamentos; 404 se não achar.
- [ ] **Step 5:** `npx tsc --noEmit`, `npm run build`. **Commit** `feat(movimentacoes): aba Movimentos com todos os movimentos do periodo e link para o documento`.

### Task 5: Aba Histórico sem truncar e mais rápida

**Files:** Modify `components/movimentacoes/HistoricoTab.tsx`.

- [ ] **Step 1:** Filtro tipo/família: `buscarTudoPaginado` (`.order('id')`); local: `posicao_estoques` só da `data_posicao` mais recente, paginado; códigos > 300 → filtro em memória (sem `.in()` na URL).
- [ ] **Step 2:** Uma leitura só (`lerTudo`, páginas em paralelo, `.order` total) para os 3 modos; totais sempre do conjunto filtrado (sem `.limit(100000)`); sem complemento do Contabo (banco principal tem desde 2025-07-01); sem `cmc_recente_da_loja` enquanto `MOSTRAR_VALORES=false`. Aviso quando bater no teto de linhas.
- [ ] **Step 3:** `npx tsc --noEmit`. **Commit** `fix(movimentacoes): Historico sem corte de 1000 produtos/linhas e sem idas ao Contabo`.

### Task 6: Barra de pesquisa das OPs

**Files:** Create `components/ordem-producao/BuscaOP.tsx`; modify `app/(app)/ordem-producao/page.tsx`.

- [ ] **Step 1:** `BuscaOP` (client): campo "Buscar OP: número, produto, cupom/obs ou data (dd/mm)" que grava `q` na URL preservando os outros filtros e tira `page`.
- [ ] **Step 2:** `page.tsx`: `interpretarBuscaOP(q)`; com `q`, o período padrão do mês deixa de valer (só datas explícitas); número → `identificacao_c_num_op.ilike.%n%` (+ `identificacao_n_cod_op.eq` se só dígitos); texto → `or(identificacao_c_num_op.ilike, observacao.ilike, obs_omie.ilike, identificacao_n_cod_produto.in.(até 300 ids do produto))`; data → previsão OU conclusão naquele dia. Contadores e exportação levam o mesmo filtro. Famílias pela tabela `familias` (antes: `produtos` inteiro, cortado em 1000).
- [ ] **Step 3:** `npx tsc --noEmit`. **Commit** `feat(op): barra de pesquisa por numero, produto, cupom/obs e data`.

### Task 7: Página da OP mostra os movimentos que gerou e a ficha usada

**Files:** Create `components/ordem-producao/MovimentosDaOP.tsx`; modify `lib/movimentacoes/dados.ts` (`movimentosDaOP`), `app/(app)/ordem-producao/[id]/page.tsx`.

**Interfaces:** `export async function movimentosDaOP(lojaId: number, op: OPMin, itens: ItemFichaOP[]): Promise<{ fonte: 'kardex' | 'ficha'; linhas: LinhaMov[]; criterio: 'documento' | 'data' | 'nenhum' | 'ficha'; aviso: string | null }>`

- [ ] **Step 1:** Loja com espelho e OP concluída: `kardex_omie` da loja, `data_mov` em [conclusão−1, conclusão+1], produtos da OP + insumos → `casarKardexComOP`. Sem espelho ou sem casamento: `movimentosPrevistosDaOP` ("pela ficha gravada na OP"). OP não concluída: "ainda não movimentou o estoque" + o previsto.
- [ ] **Step 2:** Seção "Movimentos de estoque desta OP" (tabela: produto com link, local, entrada/consumo, quantidade, origem, link "ver em Movimentações") e a ficha usada com local de consumo por insumo e link para o produto.
- [ ] **Step 3:** `npx tsc --noEmit`. **Commit** `feat(op): pagina da OP mostra movimentos gerados (kardex) e a ficha usada`.

### Task 8: Nota fiscal ↔ produto ↔ movimentos

**Files:** Create `components/nota-fiscal/MovimentosDaNota.tsx`, `components/estoque-proprio/NotasDoProduto.tsx`; modify `components/nota-fiscal/ItensNotaFiscal.tsx` (link do produto), `app/(app)/nota-fiscal/[id]/page.tsx`, `lib/movimentacoes/dados.ts` (`movimentosDaNota`), 1 linha em `app/(app)/estoque/produto/[codigo]/page.tsx`.

**Interfaces:** `export async function movimentosDaNota(lojaId: number, nota: { numero: string | null; emissao: string | null }, itens: { n_id_produto: number; codigo_local_estoque: number | null; quantidade: number }[]): Promise<{ fonte: 'kardex' | 'nota'; linhas: LinhaMov[] }>`

- [ ] **Step 1:** Itens da nota: nome do produto vira link para `/estoque/produto/<n_id_produto>` (loja Omie) e "movimentos" para `/movimentacoes?aba=movimentos&produto=<cod>&data_inicio=<emissão>&data_final=<hoje>`.
- [ ] **Step 2:** `MovimentosDaNota`: espelho → kardex de origem NF com número da nota e produtos da nota (da emissão até +30 dias); senão a entrada de cada item pela própria nota (quantidade, local).
- [ ] **Step 3:** `NotasDoProduto`: últimas 20 notas com o produto (`nota_fiscal_items` por `n_id_produto`, índice novo), data, fornecedor, quantidade, link para a nota e "ver todas" (`/nota-fiscal?produto=<codigo>`); renderizado em `/estoque/produto/[codigo]`.
- [ ] **Step 4:** `npx tsc --noEmit`. **Commit** `feat(nf): itens ligam ao produto e aos movimentos; produto mostra suas notas`.

### Task 9: Velocidade — relatório de movimentação, OPs e medição

**Files:** Modify `app/(app)/relatorio-movimentacao/page.tsx` (e `export/route.ts` se repetir o laço).

- [ ] **Step 1:** `rpcTodos`: páginas em ondas paralelas de 4 (para quando uma página vem incompleta), mantendo retry e `falhou`.
- [ ] **Step 2:** Build local; instância temporária no servidor (R10) e medir as mesmas telas; medir no Postgres local antes/depois da 170.
- [ ] **Step 3:** Atacar o que ainda passar de 1 s (ver o que custa com `console.time` local na instância temporária). **Commit** `perf: ...` por mudança.

### Task 10: Documentação e revisão

- [ ] **Step 1:** AGENTS.md: seção "Movimentações completas (13/10/2026)" (fontes, RPC, rulings, deploy: aplicar 160→161→(162)→170, `gerar-schema.sh` + versão do desktop, conferir como usuário logado).
- [ ] **Step 2:** `node --test lib/movimentacoes/movimentacoes-puro.test.ts lib/estoque/kardex-loja-puro.test.ts`, `npx tsc --noEmit`, `npm run build`. **Commit**.
- [ ] **Step 3:** Revisor único (subagente opus) do diff `nosso-omie..HEAD`; corrigir Critical/Important com teste; commit.
