# Relatórios dinâmicos (estilo Omie) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer para o Norte Estoque todos os relatórios do Omie como tabelas dinâmicas: o usuário escolhe o período, arrasta qualquer campo para linha/coluna/valor, filtra por qualquer campo e exporta — igual ao Omie.

**Architecture:** Cada família de relatórios do Omie é um *cubo* (tabela plana de linhas com ~60–200 campos). Um motor puro `pivotar()` agrega as linhas conforme um *layout* (linhas, colunas, medidas, filtros). Cada relatório do Omie vira um *preset* (cubo + layout inicial). Uma tela única `/relatorios/dinamico/[cubo]` serve todos. As linhas de cada cubo vêm de uma RPC do Postgres por loja e período, lendo as tabelas que o app já tem (`notas_fiscais`, `nota_fiscal_items` e seus `full_object`), então funciona igual nas lojas com Omie (espelho) e na ODARA (estoque próprio).

**Tech Stack:** Next.js 16 (App Router, Server Components), TypeScript, Supabase/PostgREST (RPC), exceljs (`lib/excel.ts`), testes `node:test` via `npx tsx --test` (padrão do repo: `lib/*.test.ts` importando `./x.ts`).

**Spec:** Conversa de 26/10/2026 com o dono ("relatórios estão uma merda, não estão todos os do Omie, veja como o Omie faz relatório e pega os dados") + mapeamento em `~/Projects/omie-rea/relatorios/**` (campos em `fields.json`, layout padrão em cada `.md`, dados de conferência em `data.json.gz`) + lacuna nº 127 de `omie-rea/gaps/matriz-financeiro-vendas-config-relatorios.md` ("Report engine: OLAP pivot viewer … MISSING").

## Global Constraints

- Tudo em português (PT-BR): rótulos de campo **iguais aos do Omie** (ex.: "Fornecedor/Cliente (Nome Fantasia)", "Total de Mercadoria"), para a equipe achar o que já conhece.
- Manter o visual do sistema (ui-kit, teal da marca, `PageHeader`, `PeriodoBar`); **proibido redesenhar o que existe** (regra do dono). Relatórios atuais continuam funcionando; os novos entram numa seção nova de `/relatorios`.
- Só leitura: nenhuma chamada de escrita ao Omie. Nenhum dado de loja vaza para outra (RPC com `p_loja` + RLS).
- Quantidades/valores: soma em centavos/`numeric` no banco; formato `pt-BR` na tela e no Excel.
- Migration nova numerada a partir da **299**; aplicada à mão no `supabase-db` (`-U supabase_admin -d postgres`); recarregar cache do PostgREST (`notify pgrst, 'reload schema'`).
- Deploy só com autorização do dono, conferindo hora; `deploy.sh` síncrono.
- Primeira entrega atrás de `ROTAS_SO_DEV` (só desenvolvedor vê), liberada para a ODARA depois da conferência numérica (Task 8).
- Conferência obrigatória: o total do cubo precisa bater com o total do relatório do Omie do mesmo período (Task 8) antes de liberar.

## Review Focus

- Período sem nenhuma nota → tela mostra "Nenhuma nota no período" e exporta planilha vazia com cabeçalho (não quebra).
- Campo que vem nulo (nota sem transportadora, item sem produto ligado) → agrupa em "(vazio)" em vez de sumir ou virar "undefined".
- Período grande (ano inteiro, 10 mil+ linhas) → resposta paginada por RPC em blocos e tela continua fluida; teto de linhas avisa o usuário em vez de cortar em silêncio.
- Medidas com `distinct count` (Nota Fiscal) → contam notas distintas, não itens.
- Loja de estoque próprio (ODARA) × loja com Omie → mesmos rótulos, campos que não existem num modo aparecem vazios, nunca erro.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/relatorios/pivot.ts` | Motor puro: agrega linhas em árvore linha×coluna com totais e subtotais. |
| `lib/relatorios/pivot.test.ts` | Testes do motor. |
| `lib/relatorios/cubos/tipos.ts` | Tipos `CampoCubo`, `Medida`, `Layout`, `PresetRelatorio`, `Cubo`. |
| `lib/relatorios/cubos/recebimentos.ts` | Cubo "Recebimentos" (NF de entrada): lista de campos + `linhaDoCubo()` (linha RPC → campos). |
| `lib/relatorios/cubos/recebimentos.test.ts` | Testes do mapeamento com fixture das duas lojas (Omie e própria). |
| `lib/relatorios/catalogo.ts` | Registro de cubos e presets (todos os relatórios do Omie, com slug do Omie). |
| `supabase/migrations/299_cubo_recebimentos.sql` | RPC `cubo_recebimentos(p_loja, p_ini, p_fim, p_de, p_ate)` paginada. |
| `app/(app)/relatorios/dinamico/[cubo]/page.tsx` | Página: período + preset + tabela. |
| `app/(app)/relatorios/dinamico/[cubo]/dados/route.ts` | GET JSON das linhas (loja atual, período), em blocos. |
| `app/(app)/relatorios/dinamico/[cubo]/export/route.ts` | Excel do layout atual + aba "Detalhe". |
| `components/relatorios/TabelaDinamica.tsx` | Cliente: painel de campos, linhas/colunas/valores/filtros, render da árvore, formatos. |
| `components/relatorios/PainelCampos.tsx` | Cliente: lista pesquisável de campos agrupados, escolher destino. |
| `app/(app)/relatorios/page.tsx` | Modificar: seção "Relatórios do Omie" listando presets por família. |

---

### Task 1: Motor da tabela dinâmica

**Files:**
- Create: `lib/relatorios/pivot.ts`
- Test: `lib/relatorios/pivot.test.ts`

**Interfaces:**
- Produces:
  - `type Linha = Record<string, string | number | null>`
  - `type Medida = { campo: string; agg: 'soma' | 'contagem' | 'contagem_distinta' | 'media' | 'min' | 'max' }`
  - `type Layout = { linhas: string[]; colunas: string[]; medidas: Medida[]; filtros: Record<string, string[]> }`
  - `type No = { chave: string; rotulo: string; valores: Record<string, number>; filhos: No[] }`
  - `function pivotar(linhas: Linha[], layout: Layout): { raizLinhas: No; colunas: string[]; total: Record<string, number> }`
  - `const VAZIO = '(vazio)'`

- [ ] **Step 1: Escrever os testes que falham** — em `pivot.test.ts` (`node:test`, `assert/strict`), com 4 linhas de fixture (2 fornecedores, 2 meses, `Total de Mercadoria` e `Nota Fiscal`):
  - `soma por fornecedor` → `raizLinhas.filhos` tem 2 nós com `valores['Total de Mercadoria|soma']` corretos e `total` = soma geral.
  - `linhas aninhadas fornecedor>mes` → cada fornecedor tem filhos por mês; a soma dos filhos = valor do pai.
  - `colunas por mes` → `colunas` lista os meses ordenados e cada nó tem valor por coluna na chave `"<mes>|Total de Mercadoria|soma"`.
  - `contagem_distinta` de `Nota Fiscal` conta notas distintas (2 itens da mesma nota = 1).
  - `filtros` exclui linhas fora de `filtros['Situação'] = ['Concluído']`.
  - `nulo vira (vazio)`: linha com fornecedor `null` cai no nó `VAZIO`.
  - `entrada vazia` → `total` com zeros, sem filhos, sem lançar erro.

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx --test lib/relatorios/pivot.test.ts` → falha (módulo inexistente).

- [ ] **Step 3: Implementar `pivotar`** em `lib/relatorios/pivot.ts`. Uma passada: filtra, monta a árvore de linhas por chave composta, acumula medidas por (nó × coluna), calcula médias no fim e ordena filhos pelo rótulo (datas e números em ordem natural). Sem dependência externa.

- [ ] **Step 4: Rodar e ver passar** — mesmo comando → todos verdes.

- [ ] **Step 5: Commit** — `git add lib/relatorios/pivot*.ts && git commit -m "feat(relatorios): motor de tabela dinâmica"`.

---

### Task 2: Tipos e catálogo de relatórios do Omie

**Files:**
- Create: `lib/relatorios/cubos/tipos.ts`, `lib/relatorios/catalogo.ts`
- Test: `lib/relatorios/catalogo.test.ts`

**Interfaces:**
- Consumes: `Layout`, `Medida` (Task 1).
- Produces:
  - `type CampoCubo = { id: string; rotulo: string; tipo: 'texto' | 'numero' | 'moeda' | 'data'; grupo: string }`
  - `type Cubo = { id: string; titulo: string; campos: CampoCubo[] }`
  - `type PresetRelatorio = { slugOmie: string; titulo: string; familia: 'Compras' | 'Estoque' | 'Produção' | 'Vendas' | 'Financeiro' | 'Fiscal'; cubo: string; layout: Layout; fase: 1 | 2 | 3 | 4 | 5 }`
  - `const PRESETS: PresetRelatorio[]`, `function presetPorSlug(slug: string): PresetRelatorio | undefined`

- [ ] **Step 1: Escrever o teste** — `catalogo.test.ts`: (a) todo `slugOmie` é único; (b) todo preset aponta para um cubo existente e todo campo usado no `layout` existe nesse cubo; (c) existem os 9 presets de Recebimentos com estes slugs: `rel-com-recebimentos-por-periodo`, `-por-mesano`, `-por-fornecedor`, `-por-produto`, `-por-categoria`, `-por-departamento`, `-por-projeto`, `-por-trasnportadora` (sic, é assim no Omie) e `rel-com-recebimentos-por-periodo@53=98`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `tipos.ts` e `catalogo.ts`. Os presets de Recebimentos copiam `rows`/`measures`/`report filters` do "Default layout" de cada `~/Projects/omie-rea/relatorios/COM/rel-com-recebimentos-*.md`. Os demais relatórios do Omie entram no catálogo já com `fase` ≥ 2 e `cubo` apontando para o cubo da fase (ver Fases abaixo), sem campos ainda — o teste (b) só roda para `fase: 1`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.**

---

### Task 3: Cubo "Recebimentos" — banco

**Files:**
- Create: `supabase/migrations/299_cubo_recebimentos.sql`

**Interfaces:**
- Produces: RPC `cubo_recebimentos(p_loja bigint, p_ini date, p_fim date, p_de int default 0, p_ate int default 5000) returns setof jsonb` — uma linha por **item de nota**, com `notas_fiscais` + `nota_fiscal_items` + `fornecedor` + `categorias_contabeis`, usando `d_emissao_nfe` no período, `deleted_at is null`, `security invoker`, `stable`. Cada jsonb traz as colunas de `notas_fiscais`/itens mais `nota_full` e `item_full` (os dois `full_object`) e `categoria` (nome) e `categoria_codigo`.

- [ ] **Step 1: Escrever a migration** com a função, `grant execute to authenticated`, `notify pgrst, 'reload schema'`. Ordenar por `d_emissao_nfe, n_id_receb, n_sequencia` para a paginação ser estável.
- [ ] **Step 2: Validar sem gravar** — rodar `begin; <migration>; select count(*) from cubo_recebimentos(15,'2026-10-01','2026-10-31'); rollback;` no `supabase-db` → deve devolver 302 linhas (itens da ODARA em outubro; 46 notas).
- [ ] **Step 3: Validar loja com Omie** — mesma consulta com a loja 5, período de 1 mês → contagem > 0 e `item_full->'itensCabec'` presente.
- [ ] **Step 4: Commit** (aplicar em produção só no deploy, Task 9).

---

### Task 4: Cubo "Recebimentos" — campos e mapeamento

**Files:**
- Create: `lib/relatorios/cubos/recebimentos.ts`
- Test: `lib/relatorios/cubos/recebimentos.test.ts`

**Interfaces:**
- Consumes: `CampoCubo`, `Cubo` (Task 2); formato jsonb da Task 3.
- Produces: `const CUBO_RECEBIMENTOS: Cubo`; `function linhaRecebimentos(r: LinhaRpc): Linha`.

Campos da fase 1 (rótulos do Omie, `~/Projects/omie-rea/relatorios/COM/rel-com-recebimentos-por-periodo/fields.json`), agrupados: **Nota** (Situação, Operação, Etapa, Origem, Data de Emissão, Data de Registro, Data do Recebimento, Data do Cancelamento, Nota Fiscal, Série, Chave de Acesso da NF-e, Manifestação do Destinatário, Pedido de Compra, Categoria, Departamento, Comprador, Projeto, Número de Parcelas, Dados Adicionais), **Fornecedor** (Razão Social, Nome Fantasia, CNPJ/CPF, Inscrição Estadual, Cidade, Estado), **Transportadora** (Razão Social, Nome Fantasia, CNPJ/CPF), **Item** (Item, Código do Produto, Descrição do Produto, Descrição do Produto (completa), Família de Produto, Código EAN, Código NCM, CFOP de Entrada, CFOP no Documento Fiscal, Quantidade, Unidade, Valor Unitário), **Valores** (Total de Mercadoria, Desconto, Frete, Seguro, Outras Despesas Acessórias, Total do Documento Fiscal, Valor Aprox. dos Impostos, Valor do ICMS, ICMS ST, IPI, PIS, COFINS), **Custo de Estoque** (Valor de Entrada, CMC Unitário do Movimento, flags "é custo"), mais os campos de imposto por item que existirem no `full_object`. Campo sem dado na loja → `null` (vira "(vazio)").

- [ ] **Step 1: Escrever os testes** — fixtures de uma linha da **ODARA** (copiar do `full_object` visto em produção: `itensCabec.vTotalItem` 132,05, `vDesconto` 6,95, `cNCM` "62032300", `cCFOP` "5101", `itensAjustes.cCFOPEntrada` "1.556") e uma linha de loja **Omie** (com `cabec` completo). Assertar: `linhaRecebimentos(odara)['Total de Mercadoria']` = 139 (preço × qtd, antes do desconto) e `['Desconto']` = 6,95 e `['CFOP de Entrada']` = '1.556'; campo ausente → `null`; `Situação` mapeia `c_etapa` com `statusNF` já existente.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** a lista de campos e `linhaRecebimentos`, reaproveitando `lib/nf-status.ts` (`statusNF`) e `lib/cfop.ts`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.**

---

### Task 5: Rota de dados

**Files:**
- Create: `app/(app)/relatorios/dinamico/[cubo]/dados/route.ts`

**Interfaces:**
- Consumes: RPC (Task 3), `linhaRecebimentos` (Task 4), `rpcTodos` de `@/lib/supabase/rpc-todos` (paginação existente), `getCurrentLojaId`, `requirePermissao(lojaId, 'Notas Fiscais')`.
- Produces: `GET ?ini=YYYY-MM-DD&fim=YYYY-MM-DD` → `{ campos: CampoCubo[], linhas: Linha[], truncado: boolean }`; teto de 50 000 linhas, `truncado: true` acima disso.

- [ ] **Step 1:** Implementar a rota; 401/404 quando sem permissão ou cubo desconhecido; período inválido → 400 com mensagem em português.
- [ ] **Step 2: Verificar** — com a loja da sessão, `curl` autenticado devolve JSON com `linhas.length` igual ao da Task 3 para o mesmo período.
- [ ] **Step 3: Commit.**

---

### Task 6: Tela da tabela dinâmica

**Files:**
- Create: `components/relatorios/TabelaDinamica.tsx`, `components/relatorios/PainelCampos.tsx`, `app/(app)/relatorios/dinamico/[cubo]/page.tsx`

**Interfaces:**
- Consumes: `pivotar`, `Layout` (Task 1); `PRESETS`, `presetPorSlug` (Task 2); rota de dados (Task 5); `PeriodoBar` e `lerPeriodo` (existentes em `components/faturamento` e `lib/faturamento-periodo.ts`).
- Produces: página `/relatorios/dinamico/recebimentos?preset=<slugOmie>&ini=&fim=`.

Comportamento (igual ao Omie, no visual do sistema): barra de período no topo (atalhos Hoje/30/60/90/Todos/Específico como o Omie); painel de campos à direita com busca e grupos; quatro áreas **Linhas · Colunas · Valores · Filtros** onde o campo entra com um clique ("Adicionar às linhas") e sai com um "×" e se reordena com ↑↓; escolher a agregação de cada valor (Soma, Contagem, Contagem distinta, Média, Mín, Máx); tabela com linhas expansíveis (▸), totais e subtotais, formato `pt-BR`, cabeçalho fixo e rolagem horizontal sem cortar; botão **Exportar Excel**; botão **Restaurar layout do relatório**; aviso quando `truncado`. O último layout usado por preset fica no `localStorage` (leitura/escrita em `try/catch`).

- [ ] **Step 1:** Implementar a página (servidor) que resolve o preset e o período e renderiza `TabelaDinamica` (cliente) com o preset como layout inicial.
- [ ] **Step 2:** Implementar `PainelCampos` e `TabelaDinamica`.
- [ ] **Step 3: Verificar no navegador** (conta de teste ou dono logado): abrir o preset "Recebimentos por Fornecedor" da ODARA e conferir a tabela; trocar as linhas para Categoria e ver os totais mudarem; screenshot em 1440 px e em 390 px (sem scroll horizontal da página, sem texto cortado).
- [ ] **Step 4: Commit.**

---

### Task 7: Exportar Excel

**Files:**
- Create: `app/(app)/relatorios/dinamico/[cubo]/export/route.ts`

**Interfaces:**
- Consumes: `gerarPlanilhaMulti`, `planilhaResponse`, `ColunaExcel` de `lib/excel.ts`; `pivotar`.
- Produces: POST com `{ ini, fim, layout }` → `.xlsx` com 2 abas: **Relatório** (a tabela como está na tela, totais em negrito) e **Detalhe** (todas as linhas do cubo no período, com `somar` nas colunas de moeda).

- [ ] **Step 1:** Implementar. Período sem linhas → planilha só com o cabeçalho.
- [ ] **Step 2: Verificar** — baixar o Excel do preset "por Fornecedor" e conferir que o total da aba Relatório = total da aba Detalhe.
- [ ] **Step 3: Commit.**

---

### Task 8: Hub e conferência numérica com o Omie

**Files:**
- Modify: `app/(app)/relatorios/page.tsx`, `lib/recursos-dev.ts` (adicionar `/relatorios/dinamico`), `lib/central/modulos.ts` (entrar no módulo Compras e no Fiscal)
- Create: `scripts/conferir-cubo-omie.mjs`

- [ ] **Step 1:** Seção "Relatórios do Omie" em `/relatorios`, agrupada por família, cada cartão com o **mesmo nome do Omie** e a pergunta que ele responde; presets de fase ≥ 2 aparecem desabilitados com "em breve".
- [ ] **Step 2: Conferência** — `conferir-cubo-omie.mjs` compara, para a loja 5 e o período capturado em `omie-rea/relatorios/COM/rel-com-recebimentos-por-periodo/data.json.gz`, o total de `Total de Mercadoria` e a contagem de notas distintas do cubo com os do Omie. Esperado: diferença 0,00 e mesma contagem; qualquer diferença vira lista de notas divergentes.
- [ ] **Step 3: Commit.**

---

### Task 9: Entrega

- [ ] **Step 1:** `npx tsc --noEmit`, `npx eslint` nos arquivos novos, `npx tsx --test lib/relatorios`.
- [ ] **Step 2:** Aplicar a migration 299 e fazer deploy **com autorização do dono**, conferindo a hora.
- [ ] **Step 3:** Mostrar ao dono o preset "Recebimentos por Fornecedor" da ODARA com print; ajustar o que ele apontar.

---

## Fases seguintes (um plano cada, depois que a fase 1 estiver aprovada)

| Fase | Cubo (OLAP do Omie) | Relatórios do Omie cobertos |
|---|---|---|
| 2 | Faturamento (`VEN_PRD_*`, `VEN_OP11_*`, `REM_PRD_*`) | por período, mês/ano, cliente, produto, departamento, vencimento, cancelados, denegados; pedidos e remessas; remessas faturadas |
| 3 | Estoque (`COM_EST_*`, `COM_CMV_CPV`, `COM_PRD_ABC_*`, `ERP_PRD_*`) | Kardex, Movimento resumido, Posição de estoque (+ SPED), CMV/CPV, Curva ABC, Estoque mínimo, Produtos por fornecedor, Estrutura, Lotes |
| 4 | Compras e Produção (`COM_OP*`, pedidos/requisições/retorno de remessa) | OPs (produto, MP, etapa, projeto, andamento, concluídas), pedidos de compra, requisições, retorno de remessas |
| 5 | Financeiro (`FIN_*`, `CTB_SERVTOMADOS_*`) | contas a pagar/receber, fluxo de caixa, DRE, movimentação financeira, serviços tomados |

## Fora deste plano

A tela de **dentro da nota** continua em ajuste separado (o dono ainda a considera ruim); depende de ver a tela real pelo print dele.

## Self-review

- Cobertura: o pedido "todos os relatórios do Omie + como o Omie pega os dados" → cubos + presets (Tasks 2–4, fases 2–5); "como o Omie faz relatório" → tabela dinâmica (Task 6); conferência de dados → Task 8.
- Tipos consistentes: `Layout`/`Medida`/`Linha` definidos na Task 1 e usados nas 2, 4, 6 e 7; `CampoCubo`/`Cubo`/`PresetRelatorio` na Task 2.
- Proporção: plano enxuto, sem corpos de função; decisões e valores exatos (rótulos, slugs, números de conferência) estão nos passos.

## Andamento (26/10/2026)

Feito e testado (`npx tsx --test lib/relatorios`, `tsc`, `eslint`): motor `pivotar` (com `filtros` e `exceto`), cubo Recebimentos, catálogo com os 8 relatórios de Recebimentos do Omie + 95 relatórios das fases 2–5 listados como "em breve", migration 299 (validada em produção dentro de transação desfeita), carregador com cache, rota de agregação, rota de Excel, página e hub (só desenvolvedor).

**Desvio do plano (Task 5):** a rota não devolve as linhas, e sim a árvore já agregada (`POST .../pivot`). Mandar 12 mil linhas × 60 campos ao navegador pesaria ~30 MB. As linhas ficam em cache no servidor por 2 min para trocar o layout ser instantâneo.

**Desvio da RPC (Task 3):** a primeira versão montava o JSON antes de cortar a página (0,6 s a 4 s conforme a posição). A versão final escolhe os ids da página e só monta o JSON deles: ~0,4 s por página de 1.000 linhas em qualquer posição.

### Conferência numérica com o Omie (Task 8) — loja 5 (Donana), registro de 01 a 17/10/2026, nota a nota

- Toda nota que existe nos dois lados bate em **número de itens** e em **Total de Mercadoria**. As diferenças de centavos vinham de usar o preço da coluna (2 casas) em vez do preço do `full_object` (6 casas) e de somar imposto embutido; corrigido: sem IPI/ST usa o total do item + desconto (exato), com IPI/ST usa quantidade × preço preciso.
- **O que o cubo não tem é nota que o espelho local não tem.** No Omie, notas em "Faturado pelo Fornecedor" (pendentes) não estão em `notas_fiscais` da loja 5: ex.: NF 89486 (VILLA BA, R$ 9.794,40, 15/10), NF 956433 (FRUTCOM, 34 itens, 17/10), NF 1720363 (SOST, 17/10). Isso é lacuna do espelho de NF, não do relatório; precisa de investigação própria.
- Não conferido ainda: dias 01 e 09/10 (itens a menos no espelho, mesma causa provável) e a tela no navegador (sem login de teste).
