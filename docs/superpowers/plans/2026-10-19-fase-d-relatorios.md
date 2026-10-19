# Fase D — Relatórios que faltam (Curva ABC, Posição de estoque, CMV/CPV, Movimentação pelo valor do movimento)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (execução inline, sem subagentes). Passos com checkbox (`- [ ]`).

**Goal:** dar às lojas Omie e às de estoque próprio os relatórios N10/N11, N6/N7, N9 e N13 da matriz do omie-rea, com prova numérica.

**Architecture:** regras em módulos puros (`lib/relatorios/*-puro.ts`, sem `@/`, testados com `node --test`), loaders por modo (`modo_estoque`) e telas no padrão de `/faturamento` (PeriodoBar, FiltrosFaturamento, CartaoResumo, RankingBarras). Agregação pesada sobre o kardex vira RPC SQL `security invoker` (migrations 187 e 188), testada num banco local (`ntb-teste-sql`, banco `fd`).

**Tech Stack:** Next 16.2 (App Router, server components), supabase-js, Postgres 17, exceljs (`lib/excel.ts`), `node --test`.

**Spec:** `docs/superpowers/plans/2026-10-18-plano-mestre-paridade-omie.md` (Fase D, "Os dois modos") + `~/Projects/omie-rea/gaps/matriz-compras-estoque-producao.md` (N6, N7, N9, N10, N11, N13, L7, L24) + `~/Projects/omie-rea/relatorios/COM/*` e `~/Projects/omie-rea/regras/estoque-saldo-e-custo.md`.

## O que o Omie faz (lido nas capturas da loja 5, 17–18/10/2026)

- **Curva ABC** (`COM_PRD_ABC_VALOR`/`_QUANTIDADE`, e as mesmas em Vendas): base = **valor faturado** (vendas) no período (padrão "Mês atual"). Ordena por valor (ou quantidade) decrescente; `% Acumulado` inclui o próprio item; **A = acumulado ≤ 20 %, B = ≤ 80 %, C = resto**; rótulos "A (20% das vendas)", "B (60% das vendas)", "C (20% das vendas)". Prova: loja 5, 385 produtos: A = ordens 1–2 (19,36 %), B = 3–88, C = 89–385 (89 tem 80,03 %). Por quantidade: A = 1–2, B = 3–63.
- **Posição de estoque** (`COM_EST_POS_PER`): uma linha por produto × local (o local padrão tem TODOS os produtos, inclusive saldo 0; os outros locais só com saldo), quantidade, reservada, disponível (= quantidade − reservada), CMC unitário/total por local (E1, E2), negativos entram no total (E4), inativos aparecem (E6). Total do dia 17/10: R$ 1.723.283,40 (positivos 1.814.744,45; negativos −91.461,05).
- **Posição tipo SPED** (relatório "Meus relatórios"): a mesma posição filtrada em produto ativo.
- **CMV/CPV** (`COM_CMV_CPV`): por produto, `EI + C + P − EF` (estoque inicial, compras, produção = entrada da OP, estoque final, valorizados ao CMC); filtro padrão tipos 00, 04 e 99.
- **Movimento resumido por produto** (`COM_EST_MOV_PRODUTO`): cada movimento com o seu próprio valor (saída = CMC da hora, E12; compra = custo da nota).

## O que o Norte Estoque tem para cada modo (produção, 19/10/2026, só leitura)

- Lojas Omie (2–7): `posicao_estoques` guarda só as 2 últimas fotos; `kardex_omie` só da loja 5, histórico completo de 12/09 a 16/10 (frente `kardex` em `espelho_sync_estado`; `espelho_completo` hoje desligado em todas). `movimentos` (saídas do PDV) tem `valor` = **preço de venda**, não custo. `margem_snapshot_diario` só tem CMC de tipos 00/04 com saldo positivo (falta CMC em 56 % das saídas do PDV da loja 5 em set.) — não serve de custo histórico.
- Loja própria (15): `estoque_movimentos` com `custo_unitario` por movimento; `lucro_proprio` (183) já dá faturamento × CMV por produto/família/tipo/dia/mês; `posicao_estoques` é projetado pelo ledger (132/144).

## Global Constraints

- Nada em produção: sem deploy, sem migration aplicada, sem escrita no Omie. Leitura só com `begin read only; … rollback;` pelo `docker exec -i supabase-db psql`.
- Migrations novas a partir de **187**; funções `security invoker`, `stable`, `search_path = public`, ordem total no `order by` (paginação `rpcTodos`).
- Toda leitura paginada com `.order(<coluna única>)` + `.range()`.
- Módulo puro: sem `@/`, sem importar valor de outro módulo com `.ts`; teste com `node --test arquivo.test.ts`.
- Mudança num modo não altera o outro; nenhum relatório existente muda de padrão (opção nova só por parâmetro).
- Não tocar em `/estoque/correcoes` nem `lib/correcoes/*`; não mudar `lib/movimentacao-operacao-auto.ts`.
- Sem CPF/CNPJ em tela nova nem em entregável.
- `npx tsc --noEmit -p .` limpo e testes verdes antes de cada commit; commit com as linhas de coautoria pedidas.

## Review Focus

1. Período sem venda / loja sem foto → tela vazia com explicação (não "R$ 0" sem aviso). Teste: `curvaAbc([])` e `montarPosicao` sem linhas devolvem totais zero; telas usam EmptyState.
2. Valores iguais na Curva ABC → ordem estável (desempate por rótulo) e a classe depende só do acumulado. Teste em `curva-abc-puro.test.ts`.
3. CMC absurdo do Omie (≥ 1e7 ou ≤ 0, achado de 2026-08-09) → vale 0 e é contado como "custo suspeito", nunca soma bilhões. Teste em `posicao-estoque-puro.test.ts` e `cmv-puro.test.ts`.
4. Período do CMV/valor do movimento que sai da cobertura do kardex → fonte cai para "estimado"/padrão com aviso, nunca mistura kardex parcial. Teste em `escolherFonteCmv`.
5. Foto do dia só com a sentinela (local 0) durante o sync → usar a foto mais recente que tem local real. Teste no loader via função pura `escolherFoto`.

---

### Task 1: Curva ABC por valor e por quantidade (N10/N11)

**Files:**
- Create: `lib/relatorios/curva-abc-puro.ts`, `lib/relatorios/curva-abc-puro.test.ts`, `lib/relatorios/curva-abc-omie.fixture.json` (código, valor, quantidade, classe e % acumulado do Omie, loja 5 — sem nome de cliente)
- Create: `lib/relatorios/curva-abc-loader.ts`, `app/(app)/relatorio-curva-abc/page.tsx`, `app/(app)/relatorio-curva-abc/export/route.ts`
- Modify: `app/(app)/relatorios/page.tsx` (card "Curva ABC" no grupo Faturamento)

**Interfaces (produz):**
- `type ItemAbc = { chave: string; rotulo: string; codigo: string; familia: string; tipo: string; valor: number; quant: number }`
- `type LinhaAbc = ItemAbc & { ordem: number; pct: number; acumulado: number; pctAcumulado: number; classe: 'A' | 'B' | 'C' }`
- `curvaAbc(itens: ItemAbc[], medida: 'valor' | 'quant', cortes?: { a: number; b: number }): LinhaAbc[]` — padrão `{ a: 20, b: 80 }`; ordem decrescente pela medida, desempate por rótulo; acumulado inclui o item; `pctAcumulado ≤ a + 1e-9` → A, `≤ b + 1e-9` → B, senão C; medida ≤ 0 → C.
- `resumoAbc(linhas: LinhaAbc[], medida): Record<'A'|'B'|'C', { itens: number; total: number; pct: number }>`
- `ROTULO_CLASSE = { A: 'A (20% das vendas)', B: 'B (60% das vendas)', C: 'C (20% das vendas)' }`
- `carregarBaseAbc(lojaId, ini, fim, base: 'vendas' | 'compras', filtros: { tipos: string[]; familias: string[] }): Promise<{ itens: ItemAbc[]; aviso: string | null; opcoes }>` — vendas = `carregarItens` (os dois modos) agrupado por produto; compras = `carregarNotasCompra` (válidas) + `carregarItensCompra`, valor = `valorEstoque` (padrão das telas de Compras).

- [ ] Teste: classes e % acumulado de `curvaAbc` batem com as 385 linhas do Omie (valor e quantidade); empate ordena por rótulo; lista vazia; item com valor 0 é C; resumo soma 100 %.
- [ ] Rodar e ver falhar; implementar; rodar e ver passar.
- [ ] Loader, tela (PeriodoBar padrão "Este mês"; chips Vendas/Compras e Valor/Quantidade; filtros tipo/família; cartões A/B/C; tabela com classe, ordem, produto, família, valor, %, % acumulado, quantidade; busca e filtro por classe) e Excel.
- [ ] `npx tsc --noEmit -p .`; commit.

### Task 2: Posição de estoque e posição tipo SPED (N6/N7)

**Files:**
- Create: `lib/relatorios/posicao-estoque-puro.ts` (+ `.test.ts`), `lib/relatorios/posicao-estoque-loader.ts`, `app/(app)/relatorio-posicao-estoque/page.tsx`, `app/(app)/relatorio-posicao-estoque/export/route.ts`
- Modify: `app/(app)/relatorios/page.tsx` (card no grupo "Compras e custo")

**Interfaces (produz):**
- `type LinhaFoto = { n_cod_prod: number; codigo_local_estoque: number; n_saldo: number; n_cmc: number; reservado: number | null }`
- `type MetaProduto = { codigo_produto: number; codigo: string | null; descricao: string | null; familia: string | null; tipo: string | null; unidade: string | null; ncm: string | null; inativo: boolean }`
- `custoValido(c: number): boolean` — `c > 0 && c < 1e7`
- `escolherFoto(datas: { data: string; temLocalReal: boolean }[]): string | null` — data mais recente com local real.
- `montarPosicao(foto: LinhaFoto[], produtos: MetaProduto[], locais: Map<number, { descricao: string; padrao: boolean }>, op: { ver: 'produto' | 'local' | 'sped'; zerados: boolean; inativos: boolean; tipos: string[]; familias: string[]; q: string }): { linhas: LinhaPosicao[]; total: TotalPosicao }`
- `LinhaPosicao = { chave, codProduto, codigo, descricao, familia, tipo, unidade, ncm, inativo, local: string | null, quant, reservado, disponivel, cmc, valor, custoSuspeito }`; `TotalPosicao = { linhas, quant, valor, positivo, negativo, suspeitos }`.
- Regras: local 0 (sentinela) nunca é linha; valor da linha = saldo × CMC (CMC inválido = 0 e `custoSuspeito`); visão produto soma as linhas de local (negativos entram) → o **mesmo total** nas três visões quando nada é escondido; zerados: produto sem linha entra com 0 (visão local: no local padrão); SPED: só produto ativo com saldo > 0, valor unitário = valor ÷ quantidade, com NCM/unidade/tipo.

- [ ] Teste: total igual nas visões produto e local; negativo entra no total; sentinela fora; CMC 2,7e10 vira suspeito; zerados aparecem só com a opção; inativo some sem a opção; SPED sem inativo e sem saldo ≤ 0; `escolherFoto` pula foto só com sentinela.
- [ ] Falhar → implementar → passar.
- [ ] Loader (fotos por data com local real, `posicao_estoques` paginado por `id`, produtos e locais), tela (chips Produto/Produto e local/Tipo SPED, "Mostrar zerados", "Incluir inativos", filtros, cartões total/positivos/negativos/linhas, tabela até 500 linhas com total geral de tudo) e Excel com todas as linhas.
- [ ] tsc; commit.

### Task 3: CMV/CPV para todas as lojas (N9)

**Files:**
- Create: `supabase/migrations/187_relatorio_cmv_kardex.sql`, `scripts/testes-sql/187_relatorio_cmv_kardex.sql`
- Create: `lib/relatorios/cmv-puro.ts` (+ `.test.ts`), `lib/relatorios/cmv-loader.ts`, `app/(app)/relatorio-cmv/page.tsx`, `app/(app)/relatorio-cmv/export/route.ts`
- Modify: `app/(app)/relatorios/page.tsx` (card "CMV / CPV" em "Compras e custo")

**Interfaces (produz):**
- SQL `relatorio_cmv_kardex(p_loja_id bigint, p_ini date, p_fim date) returns table(n_cod_prod bigint, ei numeric, compras numeric, producao numeric, outras_entradas numeric, vendas numeric, qtd_vendida numeric, consumo_op numeric, outras_saidas numeric, ef numeric, sem_custo integer, quebra numeric)` — depende da 173 (`saldo_em_data`, já em produção desde 18/10). Valor do movimento = `quantidade × valor_unit` (com sinal). Origem: vendas = −Σ em PDV, VEN, DVP, CVP; consumo_op = −Σ OPS; producao = Σ OPE; compras = Σ COM, IMP, CIM, DCP, CDC; resto: entrada → outras_entradas, saída → outras_saidas. EF = Σ local `saldo × cmc` de `saldo_em_data(p_fim)`; EI = `saldo_em_data(p_ini − 1)`; produto×local sem linha antes do início: EI = EF − fluxo do período. Ordem por `n_cod_prod`.
- `type FonteCmv = 'proprio' | 'kardex' | 'estimado'`
- `escolherFonteCmv(a: { modo: 'omie' | 'proprio' | 'nenhum'; kardexDesde: string | null; kardexAte: string | null; ini: string; fim: string }): FonteCmv` — proprio → proprio; omie com `kardexDesde ≤ ini` e `fim ≤ kardexAte` → kardex; senão estimado.
- `custoMedioAtual(foto: { n_cod_prod: number; codigo_local_estoque: number; n_saldo: number; n_cmc: number }[]): Map<number, number>` — média ponderada pelo saldo positivo dos locais reais; senão CMC da sentinela; senão o maior CMC válido; inválido fora.
- `type LinhaCmv = { chave: string; rotulo: string; familia: string; tipo: string; quant: number; faturamento: number; cmv: number; consumo: number; ei?: number; compras?: number; producao?: number; ef?: number }`
- `agruparCmv(linhas: LinhaCmv[], por: 'produto' | 'familia' | 'tipo'): LinhaCmv[]` (ordem CMV desc, rótulo) e `resumoCmv(linhas)` → `{ faturamento, cmv, margem, margemPct, consumo }`.
- `cmvFormulaOmie(l): number` = `ei + compras + producao − ef`.
- Loader `carregarCmv(lojaId, ini, fim, filtros, por)` → `{ fonte, linhas, aviso[], cobertura }`: proprio = `lucro_proprio` (rpcTodos); kardex = RPC 187 + faturamento (`carregarItens`); estimado = quantidade dos cupons (`carregarItens`) × `custoMedioAtual` da foto mais recente.

- [ ] Teste SQL (banco local `fd`): produto com compra, saída de PDV e OPE; EI/EF pela cadeia; `EI + C + P − EF` = vendas + consumo + outras saídas − outras entradas; cancelado fora; local sem histórico anterior.
- [ ] Testes puros: `escolherFonteCmv` (borda inicial/final, sem kardex, proprio); `custoMedioAtual` (ponderado, sentinela, inválido); `agruparCmv`/`resumoCmv`.
- [ ] Implementar; rodar SQL e `node --test`.
- [ ] Tela: banner da fonte ("custo de cada baixa", "kardex do Omie de dd/mm a dd/mm", "estimado: quantidade vendida × custo médio de hoje"); cartões Faturamento, CMV, Margem bruta, CPV (consumo da produção, só kardex); abas Produtos/Famílias/Tipos e, no kardex, "Pelo estoque (EI + C + P − EF)" com total dos tipos 00/04/99; Excel.
- [ ] Prova em produção (SQL inline, loja 5, 12/09–13/10 e o EF de 16/10 × EI do Omie de 17/10); tsc; commit.

### Task 4: Movimentação valorizada pelo valor do movimento (N13)

**Files:**
- Create: `supabase/migrations/188_movimentacao_valor_movimento.sql`, `scripts/testes-sql/188_movimentacao_valor_movimento.sql`
- Modify: `app/(app)/relatorio-movimentacao/page.tsx` e `export/route.ts` (modo "Por operação (R$)": opção `?valor=movimento`; na execução viu-se que o modo "Em quantidade" não mostra R$, então a opção foi para onde o R$ aparece)
- Modify: `lib/relatorios/cmv-puro.ts` (reaproveita `escolherFonteCmv` como `fonteValorMovimento`)

**Interfaces:**
- SQL `relatorio_movimentacao_valor_mov(p_loja_id bigint, p_ini date, p_fim date) returns table(origem, sentido, codigo_local_estoque, n_cod_prod, mes, inventario, qtde, valor, sem_custo)` — linhas no formato do modo automático (`LinhaOperAuto`). Loja `proprio`: `estoque_movimentos` (data_ref, valor = |q| × custo_unitario); senão `kardex_omie` não cancelado (valor = |q| × valor_unit). Entradas = q > 0, saídas = q < 0. Ordem `1, 2`.
- Padrão da tela não muda (último preço de compra). `valor=movimento` só usa a RPC nova quando a fonte cobre o período (proprio sempre; Omie só com kardex cobrindo [ini, fim]); senão aviso e padrão. Decisão de trocar o padrão fica com o dono.

- [ ] Teste SQL: rótulos por tipo/família/produto, sentido, filtro de produto, loja própria × Omie.
- [ ] Implementar migration e opção na tela; tsc; prova (loja 5, set./out.: valor do movimento × último preço de compra); commit.

### Task 5: Documentação e fechamento

- [ ] AGENTS.md: seção "Fase D (19/10/2026)" com telas, regras, migrations 187 → 188 (a 173 já está em produção), deploy (`desktop/scripts/gerar-schema.sh`), limites conhecidos.
- [ ] `node scripts/inserir-via-desktop.mjs` só se houver server action nova (não há: telas e GETs).
- [ ] Todos os testes da fase + tsc; commit final.
