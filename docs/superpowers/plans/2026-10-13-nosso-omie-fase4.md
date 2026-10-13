# "Nosso Omie" Fase 4 — escrever no Omie pela tela — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na loja `modo_estoque='omie'`, lançar Entrada/Saída/Ajuste e Transferência pelas telas de estoque, concluir/excluir/redatar OPs em lote, trocar insumo em massa nas fichas e corrigir o custo de um ajuste — tudo escrevendo no Omie com permissão própria, loja 4 bloqueada, `is_test` simulado e `audit_log`.

**Architecture:** Regras de decisão/prévia num módulo puro (`lib/estoque/escrita-omie-puro.ts`, `node --test`). Server actions novas e finas (`lib/actions/estoque-omie.ts`, `lib/actions/fichas-omie.ts`, `lib/actions/ops-lote.ts`) que reaproveitam as actions/funções Omie existentes; cada action faz **uma** unidade de trabalho (um prato, uma OP, um ajuste) e o cliente chama em sequência, mostrando o progresso e parando no primeiro erro de limite (o nginx corta em 60 s; uma escrita por vez). Correção de custo usa a tabela nova `estoque_correcao_custo` (migration 162) como trava e registro para refazer.

**Tech Stack:** Next.js (App Router, server actions), Supabase (PostgREST), API do Omie via `omieRequest`, TypeScript, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-13-nosso-omie-design.md` (Fase 4, itens 1–5; regras transversais §3).

## Global Constraints

- Só loja `modo_estoque='omie'`; loja **4** bloqueada nesta rodada com mensagem clara; `is_test` sempre no `.select()` de `lojas` (escrita simulada pelo `omieRequest`).
- Toda escrita: permissão própria (`Estoque - Lancar no Omie`, `Estoque - Corrigir custo`, `Fichas - Trocar insumo`, `OP - Acoes em lote`), `registrarAuditoria`, `revalidatePath`.
- No máximo 1 escrita no Omie por vez; parar no 1º MISUSE/limite (`/MISUSE|consumo indevido|bloquead|REDUNDANT|consumo redundante|j. existe uma requisi|too many requests/i`).
- `IncluirEstrutura` com `intMalha` (formato validado pela faxina em 11/10: `itemMalhaIncluir: [{ intMalha, idProdMalha, quantProdMalha, percPerdaProdMalha }]`) → reler → `ExcluirEstrutura` → reler. Nunca `AlterarEstrutura` para trocar produto.
- Migrations a partir de **162**, manuais, NÃO aplicar. Sem deploy, sem push, sem chamar o Omie.
- Server action nova → `node scripts/inserir-via-desktop.mjs`; escritas simples no Omie como `depende` em `lib/offline/politica.ts`.
- Testes puros sem `@/` (import com `.ts`), `npx tsc --noEmit`, `npm run build`. Textos em português simples.

## Rulings (decisões sem perguntar)

- R1. Item 1 exige `Estoque - Lancar no Omie` **e** as permissões já checadas dentro das actions reaproveitadas (`Movimentacoes - Criar`, `Transferencias - Criar/Editar`).
- R2. Entrada no Omie não aceita custo (o `criarAjusteManual` usa o CMC lido ao vivo); o modal esconde custo/lote/validade e explica. "Mínimo" não aparece em loja Omie (o mínimo vem do Omie).
- R3. "Saldo contado" no Omie: lê o saldo ao vivo (`ListarPosEstoque` do local) e lança a diferença como ENT/SAI pelo `criarAjusteManual`.
- R4. Transferência na tela = `createTransferencia` + `addMovimento` + `enviarMovimento` (+ `finishTransferencia` só se o item concluiu, sem nova chamada ao Omie). Se o Omie não confirmar, a transferência fica pendente e o cron reenvia.
- R5. Lote de OPs: cliente chama 1 OP por vez; a action exige `OP - Acoes em lote` e delega a `finishOP`/`excluirOP`/`setDataOP` (que conferem a permissão específica). Só OP aberta, com código do Omie. Concluída com sucesso em loja com espelho → `aberta_omie=false` na hora. Máximo 100 OPs por seleção.
- R6. Sobrando/faltando usa o saldo do **local da OP** (`identificacao_codigo_local_estoque`); OP sem local usa o total. Na Saúde: faltando = prato com saldo < 0 em algum local sem OP aberta naquele local (OP sem local cobre todos).
- R7. Troca de insumo: o novo item herda a quantidade de cada prato (ou a quantidade fixa informada) e a perda do item antigo. O local de consumo do item novo NÃO é gravado (o Omie só aceita no `AlterarEstrutura` depois; fora do escopo) — a prévia avisa. Loja de teste lê as fichas da loja real de origem (`loja_origem_id`, só leitura do cache) e pula as releituras (escrita simulada).
- R8. Correção de custo só para ajuste ENT/SAI com `id_ajuste`, sem transferência, sem inventário (`cod_int_ajuste` `ITEM…`) e que não seja venda (PDV). Antes de excluir confere o ajuste no Omie (lista do dia) — loja de teste pula. Relança com `cod_int_ajuste = CUSTO-<id da correção>` (o refazer procura esse código antes de incluir de novo: nunca duplica).
- R9. Mês fechado: mês do ajuste anterior ao mês passado (hoje 13/10 → agosto ou antes), ou ≤ `ESTOQUE_MES_FECHADO_ATE` (YYYY-MM, env opcional). Exige a 2ª confirmação na tela e no servidor.
- R10. As 3 actions de correção/troca ficam FORA de `politica.ts` (só com internet, nunca na fila offline: excluir com prévia velha é perigoso). Entrada/ajuste/transferência Omie e OP em lote = `depende`.

## Review Focus

1. Duplo clique / duas abas corrigindo o mesmo ajuste → só uma correção (índice único parcial da 162) — teste da regra `proximaEtapaCorrecao`.
2. Relançamento que dá timeout depois de excluir → fica `pendente_relancar`, refazer procura `CUSTO-<id>` antes de incluir — teste de `codIntCorrecao`/`proximaEtapaCorrecao`.
3. Ficha mudou entre a prévia e a execução (insumo antigo saiu, novo já está) → para sem escrever — testes de `conferirAntesDaTroca`.
4. Releitura depois do Incluir não mostra o novo item (ou mostra dois) → para e avisa "confira no Omie" — testes de `conferirTroca`.
5. OP selecionada que já foi concluída/excluída em outra aba → ignorada com motivo — teste de `selecionarLoteOPs`.

---

## File Structure

- Create `lib/estoque/escrita-omie-puro.ts` (+ `.test.ts`): bloqueio de loja, delta do ajuste, mês fechado, impacto do custo, elegibilidade da correção, trocas, conferências, lote de OPs, limite do Omie, saldo do local da OP.
- Create `supabase/migrations/162_escrita_omie_tela.sql`: 4 permissões + `estoque_correcao_custo`.
- Create `lib/actions/estoque-omie.ts`: `entradaOmie`, `ajusteOmie`, `transferirOmie`, `corrigirCustoAjuste`, `relancarCorrecaoCusto`.
- Create `lib/actions/fichas-omie.ts`: `trocarInsumoNoPrato`.
- Create `lib/actions/ops-lote.ts`: `acaoOPLote`.
- Create `lib/estoque/contexto-escrita-omie.ts` (servidor, sem 'use server'): `contextoEscritaOmie(permissao)`.
- Modify `lib/omie/ajuste.ts`: `listarAjustesDoDia`, `incluirAjusteComCusto`.
- Modify `lib/omie/malha.ts`: `incluirItemEstrutura` (com `intMalha`).
- Modify `lib/omie/fichas.ts`: extrair `gravarFichaLida` (reuso após a troca).
- Modify `components/estoque-proprio/Acoes.tsx`: prop `destino`.
- Create `components/estoque-proprio/LoteOPs.tsx`, `TrocarInsumo.tsx`, `CorrigirCusto.tsx`.
- Modify páginas: `estoque/page.tsx`, `estoque/produto/[codigo]/page.tsx`, `ordem-producao/abertas/page.tsx`, `estoque/fichas/page.tsx`, `estoque/ajustes/page.tsx`, `estoque/dados-saude.ts`, `lib/estoque/saude-puro.ts`.
- Modify `lib/permissoes-catalogo.ts`, `lib/offline/politica.ts`, `lib/offline/registro-acoes.ts` (gerado), `AGENTS.md`.

### Task 1: Regras puras da escrita

**Files:** Create `lib/estoque/escrita-omie-puro.ts`, `lib/estoque/escrita-omie-puro.test.ts`

**Interfaces (Produces):**
```ts
export const LOJA_BLOQUEADA = 4
export function bloqueioDeEscrita(l: { id: number; modo: string }): string | null
export function deltaDoAjuste(i: { modo: 'contagem' | 'diferenca'; valor: number; saldoAtual: number }): { tipo: 'ENT' | 'SAI'; quantidade: number } | { erro: string }
export function mesDoAjusteFechado(dataISO: string, hojeISO: string, fechadoAte?: string | null): boolean
export function impactoCorrecaoCusto(i: { tipo: 'ENT' | 'SAI'; quantidade: number; custoAtual: number; custoNovo: number }): { quantidade: number; valorAtual: number; valorNovo: number; diferenca: number; efeitoNoEstoque: number }
export function validarCustoNovo(custoNovo: number, custoAtual: number): string | null
export type AjusteParaCorrigir = { tipo: string; id_ajuste: number | null; transferencia_id: number | null; cod_int_ajuste: string | null; origem: string | null; motivo: string | null; origem_ajuste: string | null; quan: number | null; valor: number | null; codigo_local_estoque: number | null }
export function motivoNaoCorrige(a: AjusteParaCorrigir): string | null
export const codIntCorrecao: (id: number) => string // `CUSTO-${id}`
export function proximaEtapaCorrecao(status: string, atualizadoEm: string, agoraMs: number): 'relancar' | 'verificar_exclusao' | null
export type ItemFicha = { produto: number; insumo: number; quantidade: number; perda: number }
export type Troca = { produto: number; quantidadeAtual: number; quantidadeNova: number; perda: number; jaTemNovo: boolean }
export function montarTrocas(itens: ItemFicha[], de: number, para: number, quantidadeFixa: number | null): Troca[]
export type ItemLido = { idMalha: number; idProdMalha: number; quantProdMalha: number; percPerdaProdMalha?: number }
export function conferirAntesDaTroca(itens: ItemLido[], de: number, para: number): { ok: true; antigo: ItemLido } | { ok: false; motivo: string }
export function conferirTroca(etapa: 'incluido' | 'excluido', itens: ItemLido[], de: number, para: number, quantidadeNova: number): { ok: true } | { ok: false; motivo: string }
export function intMalhaDaTroca(agoraMs: number, sorte: number): string
export function ehLimiteOmie(msg: string): boolean
export function selecionarLoteOPs(ops: { id: number; nCodOP: number | null; aberta: boolean }[], ids: number[], max?: number): { validas: number[]; ignoradas: { id: number; motivo: string }[] }
export function saldoNoLocalDaOP(locais: { codigoLocal: number; saldo: number }[], localOP: number | null, total: number): number
export function isoParaBR(iso: string): string
```

- [ ] Step 1: escrever os testes (cobrindo: loja 4 e modo ≠ omie bloqueados; contagem 10 com saldo 12 → SAI 2; diferença 0 → erro; mês: `2026-08-31` fechado em `2026-10-13`, `2026-09-01` aberto, virada de ano `2025-11-30`/`2026-01-05` fechado e `2025-12-10` aberto, `fechadoAte='2026-09'` fecha setembro; impacto ENT 10 × (2→3) = +10, SAI efeito −10; custo novo ≤ 0, igual ao atual, ≥ 1e7 → erro; correção recusa TRF/SLD, sem id_ajuste, com transferência, `ITEM123`, PDV; `proximaEtapaCorrecao`: pendente → relancar, relancando novo (< 10 min) → null, relancando velho → relancar, excluindo velho → verificar_exclusao, concluido → null; `montarTrocas` usa qtd do prato ou fixa, marca `jaTemNovo`, ignora prato sem o insumo, ordena por produto; `conferirAntesDaTroca`: antigo ausente / duplicado / novo já presente → para; `conferirTroca('incluido')` exige novo 1× com a qtd e antigo ainda lá; `('excluido')` exige antigo ausente e novo 1×; `ehLimiteOmie`; `selecionarLoteOPs` ignora fechada, sem código, inexistente, duplicada e corta em `max`; `saldoNoLocalDaOP` local/sem local/local sem saldo = 0; `intMalhaDaTroca` ≤ 20 caracteres e começa com `TRC`).
- [ ] Step 2: `node --test lib/estoque/escrita-omie-puro.test.ts` → FAIL (módulo não existe).
- [ ] Step 3: implementar.
- [ ] Step 4: PASS.
- [ ] Step 5: commit `feat(estoque): regras puras da escrita no Omie pela tela (Fase 4)`.

### Task 2: OPs sobrando/faltando pelo saldo do local da OP

**Files:** Modify `app/(app)/ordem-producao/abertas/page.tsx`, `lib/estoque/saude-puro.ts` (+ test), `app/(app)/estoque/dados-saude.ts`.

- [ ] Step 1: teste em `saude-puro.test.ts`: `opsSobrandoFaltando(saldos, tipos, abertas, true, saldosLocal)` com OP do cupom no local 2 (saldo local −1, total +5) → NÃO sobrando; prato com local 3 negativo e OP só no local 2 → faltando; OP sem local cobre todos os locais.
- [ ] Step 2: FAIL. Step 3: `OPAbertaMin` ganha `local?: number | null`; parâmetro opcional `saldosLocal?: Map<string, number>` (chave `prod:local`); sem ele, comportamento antigo. Página das OPs usa `saldoNoLocalDaOP(p.locais, local, p.saldo)` e o rótulo "saldo no local". `dados-saude.ts` monta `saldosLocal` da visão e passa `local` das OPs.
- [ ] Step 4: PASS + `npx tsc --noEmit`. Step 5: commit `fix(op): sobrando/faltando pelo saldo do local da OP (tela de OPs e Saúde)`.

### Task 3: Migration 162 + permissões + contexto de escrita + helpers do Omie

**Files:** Create `supabase/migrations/162_escrita_omie_tela.sql`, `lib/estoque/contexto-escrita-omie.ts`; Modify `lib/permissoes-catalogo.ts`, `lib/omie/ajuste.ts`, `lib/omie/malha.ts`, `lib/omie/fichas.ts`.

Migration:
```sql
insert into permissoes (nome) values ('Estoque - Lancar no Omie'), ('Estoque - Corrigir custo'), ('Fichas - Trocar insumo'), ('OP - Acoes em lote') on conflict (nome) do nothing;
create table if not exists public.estoque_correcao_custo (
  id bigserial primary key, loja_id bigint not null references public.lojas(id) on delete cascade,
  movimento_id bigint not null, id_ajuste_antigo bigint not null, id_ajuste_novo bigint,
  id_prod bigint not null, codigo_local_estoque bigint not null, tipo text not null check (tipo in ('ENT','SAI')),
  quantidade numeric not null, data_ajuste date not null, motivo text, obs_original text,
  custo_antigo numeric, custo_novo numeric not null, mes_fechado boolean not null default false,
  status text not null check (status in ('excluindo','relancando','concluido','pendente_relancar','falha_exclusao','cancelada')),
  erro text, user_id uuid, user_nome text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index if not exists estoque_correcao_custo_em_andamento on public.estoque_correcao_custo (loja_id, id_ajuste_antigo)
  where status in ('excluindo','relancando','pendente_relancar');
-- RLS: leitura por loja no padrão initplan da 156; escrita só service role.
```
`contextoEscritaOmie(permissao)`: `getCurrentLojaId` → `requirePermissao` → `lojas.select('id, omie_app_key, omie_app_secret, is_test, modo_estoque, loja_origem_id')` → `bloqueioDeEscrita` → `{ loja, lojaId, modo }` ou `{ error }`.
`listarAjustesDoDia(loja, dataBR, maxPaginas=3)`: `ListarAjusteEstoque` com `data_movimento_de/ate`, 50 por página → `{ ajustes, completa }`. `incluirAjusteComCusto(loja, param)`: `IncluirAjusteEstoque` + `logIntegrationAttempt`.
`incluirItemEstrutura(loja, idProduto, { intMalha, idProdMalha, quantProdMalha, percPerdaProdMalha })` com `itemMalhaIncluir: [ {...} ]`.
`gravarFichaLida(supabase, lojaId, codigoProduto, itens, tipoPorCodigo)` extraído do laço de `sincronizarFichasLoja` (mesmo comportamento).

- [ ] Steps: escrever, `npx tsc --noEmit`, `node --test lib/estoque/fichas-puro.test.ts` (sem regressão), commit `feat(estoque): migration 162 (permissões e correção de custo), contexto e helpers de escrita no Omie`.

### Task 4: Entrada/Saída/Ajuste e Transferência nas telas de estoque (loja Omie)

**Files:** Create `lib/actions/estoque-omie.ts` (`entradaOmie`, `ajusteOmie`, `transferirOmie`); Modify `components/estoque-proprio/Acoes.tsx`, `app/(app)/estoque/page.tsx`, `app/(app)/estoque/produto/[codigo]/page.tsx`.

Retorno no formato do `useEnvio`: `{ error } | { ok: true; aviso? }`. `criarAjusteManual` status `Concluido` → ok; `Sem CMC` → ok com aviso "fica pendente e é reenviado"; `Erro` → error. `ajusteOmie` em "Saldo contado" lê `getPosicaoProduto(loja, local, prod, hoje)` (sem posição = 0) e usa `deltaDoAjuste`. `Acoes.tsx`: `destino?: 'proprio' | 'omie'`; no Omie a entrada só tem local, quantidade e observação, com a nota do custo médio; `AcoesProduto` não mostra Mínimo. Telas: `podeLancarOmie = ehOmie && lojaId !== 4 && Estoque - Lancar no Omie && Movimentacoes - Criar`; com `?data=` (saldo em data) não mostra o botão na lista. Loja 4: faixa "escrita pela tela bloqueada nesta rodada".

- [ ] Steps: implementar, `node scripts/inserir-via-desktop.mjs`, `politica.ts` (`depende`), `npx tsc --noEmit`, commit `feat(estoque): entrada, ajuste e transferência no Omie pela tela de estoque`.

### Task 5: OPs em lote em /ordem-producao/abertas

**Files:** Create `lib/actions/ops-lote.ts` (`acaoOPLote({ acao, opId, dataISO? })`), `components/estoque-proprio/LoteOPs.tsx` (provider + `CheckOP` + barra); Modify `app/(app)/ordem-producao/abertas/page.tsx`.

Action: contexto (`OP - Acoes em lote`), relê a OP (`id, identificacao_n_cod_op, concluida, aberta_omie?`), `selecionarLoteOPs` com 1 OP, trava `op:<id>` 120 s, delega; concluir OK → audita `concluir` e `aberta_omie=false` (ignora erro de coluna); devolve `{ ok } | { error, parar }` (`parar = ehLimiteOmie`). Cliente: seleção (máx. 100), diálogo de confirmação (data para "Mudar data"), 1 OP por vez, para no `parar`, lista do resultado, `router.refresh()`.

- [ ] Steps: implementar, script desktop + `depende`, tsc, commit `feat(op): concluir, excluir e mudar data de OPs em lote na tela de OPs abertas`.

### Task 6: Trocar insumo em massa em /estoque/fichas

**Files:** Create `lib/actions/fichas-omie.ts` (`trocarInsumoNoPrato({ de, para, quantidadeFixa, produto })`), `components/estoque-proprio/TrocarInsumo.tsx` (formulário de/para/qtd → URL; `ConfirmarTroca` com caixas por prato, confirmação e execução 1 a 1); Modify `app/(app)/estoque/fichas/page.tsx` (`?troca_de=&troca_para=&troca_qtd=` → prévia com `montarTrocas`, aviso do local de consumo).

Action por prato: contexto (`Fichas - Trocar insumo`), valida de ≠ para e produto novo ativo; trava `ficha:<prato>`; loja real: `consultarEstrutura` → `conferirAntesDaTroca` → `incluirItemEstrutura` (qtd fixa ou a do item antigo lido ao vivo, perda do antigo) → pausa 1,5 s → reler → `conferirTroca('incluido')` → `excluirEstrutura(idMalha antigo)` → pausa → reler → `conferirTroca('excluido')` → `gravarFichaLida`; loja de teste: dados do cache da origem, escritas simuladas, sem releitura. Retorno `{ ok, simulado } | { error, etapa: 'nada_feito' | 'incluido_sem_excluir' | 'nao_confirmado', parar }`. Audita `editar`/`ficha técnica`.

- [ ] Steps: implementar, script desktop (fora da política, R10), tsc, commit `feat(estoque): trocar insumo em massa nas fichas (incluir, reler, excluir, reler)`.

### Task 7: Corrigir custo de um ajuste em /estoque/ajustes

**Files:** Modify `lib/actions/estoque-omie.ts` (`corrigirCustoAjuste`, `relancarCorrecaoCusto`), `app/(app)/estoque/ajustes/page.tsx`; Create `components/estoque-proprio/CorrigirCusto.tsx`.

Fluxo `corrigirCustoAjuste({ movimentoId, custoNovo, custoAtualVisto, confirmarMesFechado })`: contexto → linha do `movimentos` da loja → `motivoNaoCorrige` → custo visto = custo do banco → `validarCustoNovo` → mês fechado exige confirmação → insere correção `excluindo` (23505 = já em andamento; tabela ausente = "ainda não ativada") → loja real: confere no Omie (`listarAjustesDoDia`, produto/local/quantidade/tipo/custo) → `excluirAjusteEstoque` (falso → `falha_exclusao`, nada mudou) → `relancando` → `IncluirAjusteEstoque` com o custo novo e `CUSTO-<id>` (falha → `pendente_relancar`, mensagem clara) → `concluido`, atualiza a linha do `movimentos` (`id_ajuste`, `valor`, `cod_int_ajuste`, `obs`; se o índice único reclamar, a linha nova já veio do sync e a antiga é apagada) → audita → revalida. `relancarCorrecaoCusto(id)`: reivindica a linha (update condicional por status/`updated_at`), `verificar_exclusao` confere se o antigo ainda existe (existe → `cancelada`), procura `CUSTO-<id>` no dia antes de incluir. Tela: botão "Corrigir custo" nas linhas elegíveis, diálogo com prévia (`impactoCorrecaoCusto`), confirmação explícita e 2ª confirmação de mês fechado; faixa "Correções pendentes" com "Refazer".

- [ ] Steps: implementar, script desktop (fora da política), tsc, commit `feat(estoque): corrigir custo de um ajuste (excluir e relançar no Omie) com prévia e mês fechado`.

### Task 8: Fechamento

- [ ] `node --test` de todos os puros, `npx tsc --noEmit`, `npm run build`.
- [ ] AGENTS.md: seção "Nosso Omie Fase 4" (telas, permissões, 162, rulings, como testar na loja de teste, deploy). Commit `docs: AGENTS.md - Fase 4 do nosso Omie`.
- [ ] Revisor único (opus) do diff da Fase 4; corrigir Critical/Important com teste; commit.
