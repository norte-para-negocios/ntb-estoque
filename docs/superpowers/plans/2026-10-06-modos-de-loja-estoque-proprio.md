# Modos de loja: Norte Vendas + Omie, Vendas + Estoque próprio, só Vendas, só Estoque — Plano mestre

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans. Steps usam `- [ ]`. Este é o PLANO MESTRE: a Fase 1 está detalhada em tarefas; as Fases 2-5 viram planos próprios (um por subsistema) quando chegar a vez.

**Goal:** cada loja escolhe como trabalha com estoque. Modo `omie` (hoje), `proprio` (o Norte Estoque é o ERP de estoque: produtos com código nosso, locais, saldo, entrada, ajuste, produção, inventário, transferência, nota de entrada), `nenhum` (só Vendas, sem baixa). "Só Estoque" (sem Vendas) sai de graça do modo `proprio`, porque a integração com o Vendas é opcional. Primeira loja: ODARA BEACH, `proprio`.

**Architecture:** (1) uma coluna de modo por loja nos dois sistemas; (2) no Estoque, uma camada de domínio (`lib/estoque/`) com dois drivers (`omie` = código de hoje, `proprio` = banco local) escolhidos pela loja; (3) um **ledger único** `estoque_movimentos` com saldo atômico por (loja, local, produto) e CMC por média móvel, projetado em `posicao_estoques` para os relatórios atuais continuarem funcionando sem reescrita; (4) o Vendas continua PDV + fiscal e passa a ter "Locais de estoque" e códigos por categoria; (5) nenhuma chamada ao Omie em loja `proprio`/`nenhum`.

**Tech Stack:** Next.js 16 (os dois), Postgres self-hosted no Contabo (migrations aplicadas via `docker exec`, ver AGENTS.md dos dois repos), Norte Vendas com `scripts/e2e/portao-deploy.sh` antes de qualquer deploy.

**Spec/insumos:** análises de 06/10/2026 (Estoque: acoplamento ao Omie; Vendas: caminho sem Omie), plano anterior `2026-08-18-estoque-independente-omie-lojas-teste.md` (lojas de teste, ledger sem local; este plano o substitui no que for mais amplo), cofre `chaves-apis-joaquim/odara-beach/`.

## Global Constraints

- **Loja `omie` não muda nada.** Todo código novo é aditivo e gateado pelo modo; o Sertão e as lojas reais seguem idênticos. Teste de regressão obrigatório: modo `omie` chama o mesmo caminho de antes.
- **Modo vem de coluna própria** (`lojas.modo_estoque`, `stores.stock_mode`), nunca de `is_test`. Coluna nova em `lojas` precisa de `GRANT SELECT (col) ON lojas TO anon, authenticated` (grant da migration 109 é snapshot fixo) e entrar nos `select` explícitos (o `tsc` não pega).
- **Loja `proprio` nunca chama `omieRequest`.** Teste: `omieRequest` lançando erro no ambiente de teste, loja `proprio` percorre o fluxo inteiro sem acioná-lo.
- **Códigos:** faixas por tipo de item iguais às do Omie (`lib/constants-omie.ts`): 90 acabado/revenda (vendável), 80 matéria-prima, 70 intermediário, 60 material de consumo, 50 ativo/outros. Bar e cozinha se separam por **família** e **local**, não por prefixo. Código único por loja em modo `proprio` (`unique (loja_id, codigo)` por gatilho).
- **IDs locais:** `codigo_produto` e `codigo_local_estoque` de loja `proprio` vêm de sequências próprias (faixa ≥ 8.000.000.000.000, longe dos ids do Omie e sem negativos, que colidem com o modo simulado).
- **Saldo negativo é permitido** (restaurante vende antes de lançar a entrada) e gera alerta, nunca bloqueia a venda.
- **Idempotência:** todo movimento tem `(loja_id, origem, ref, produto, local)` único; reenvio da venda não baixa duas vezes.
- Portão do Vendas passa antes de qualquer deploy; migrations do Estoque aplicadas via `docker exec ... -d postgres` e testadas antes em transação com ROLLBACK.
- Textos: loja `proprio`/`nenhum` nunca vê a palavra "Omie".

## Review Focus (o que a especificação implica e nenhuma tarefa testaria sozinha)

1. **Concorrência do saldo:** duas vendas ao mesmo tempo no mesmo produto/local — saldo final e `saldo_apos` consistentes (lock por linha, teste com 20 baixas paralelas).
2. **Unidades:** receita em gramas, estoque em kg. Regra: quantidades sempre na **unidade base do produto**; a ficha técnica usa a mesma unidade e a tela mostra a unidade ao lado de todo número.
3. **Custo zero:** entrada sem custo não pode zerar o CMC (mantém o anterior e avisa), venda de item sem custo não trava (nada de "Sem CMC" como no Omie).
4. **Produto sem código ou duplicado:** não baixa em silêncio; alerta visível no Vendas e no Estoque; código repetido recusado na criação.
5. **Venda cancelada/estornada:** devolve ao ledger com o mesmo `ref`, sem apagar histórico.
6. **Troca de modo de uma loja existente** (omie → proprio): bloqueada depois do primeiro movimento; antes disso, só admin.

## Modos (por loja)

| Modo | Dono do estoque | Vendas faz | Estoque faz |
|---|---|---|---|
| `omie` | Omie | baixa via Estoque→Omie (como hoje) | espelho + escrita no Omie (como hoje) |
| `proprio` | Norte Estoque | baixa via ledger local | cadastro, locais, saldo, entrada, produção, inventário, transferência, NF de entrada |
| `nenhum` | ninguém | só venda e nota | nada |
| só Estoque | Norte Estoque | (não usa) | igual a `proprio`, sem integração |

## File Structure

- Estoque: `supabase/migrations/132_modo_estoque_e_ledger.sql`, `lib/estoque/{driver.ts,omie-driver.ts,proprio-driver.ts,codigos.ts,ledger.ts}`, `app/(app)/estoque/*` (tela nova), `app/api/integracao/{lojas,locais-estoque,produtos,ordem-producao,saldo,status}/route.ts` (ajustes), `components/loja/LojaForm.tsx`.
- Vendas: `supabase/migrations/167_modo_estoque.sql`, `lib/modoEstoque.ts`, `components/modules/AdminModule.tsx` (seletor), `components/modules/LocaisEstoqueView.tsx` (nova), `app/api/integracao/locais-estoque-criar/route.ts` (nova), `lib/baixaEstoqueServidor.ts`, `lib/cardapioIntegridade.ts`, textos "Omie" condicionais.

---

## FASE 1 — Estoque próprio mínimo ponta a ponta + loja ODARA (meta: usável amanhã)

### Task 1: Modo da loja e ledger no Estoque (banco)
**Files:** Create `supabase/migrations/132_modo_estoque_e_ledger.sql` · Test: transação com ROLLBACK + `scripts/testes/ledger.test.ts`
**Interfaces — Produces:** `lojas.modo_estoque text not null default 'omie' check in ('omie','proprio','nenhum')`; `estoque_movimentos(id, loja_id, local_id, codigo_produto, tipo, origem, ref, quantidade, custo_unitario, saldo_apos, cmc_apos, user_id, obs, created_at)` com `unique (loja_id, origem, ref, codigo_produto, local_id)`; `estoque_saldos(loja_id, local_id, codigo_produto, saldo, cmc, minimo, updated_at)`; RPC `registrar_movimento(p_loja uuid/bigint, p_local bigint, p_produto bigint, p_tipo text, p_origem text, p_ref text, p_quantidade numeric, p_custo numeric, p_user uuid, p_obs text) returns jsonb` (atômica, lock por linha, CMC médio móvel, idempotente, projeta em `posicao_estoques`); sequências `seq_codigo_produto_proprio`, `seq_codigo_local_proprio`; gatilho de código único por loja `proprio`.
- [ ] Escrever o teste de saldo/CMC/idempotência/concorrência (20 baixas paralelas) e vê-lo falhar
- [ ] Escrever a migration, testar em transação com ROLLBACK no banco real, aplicar
- [ ] Teste de regressão: loja `omie` e todas as RPCs atuais inalteradas
- [ ] Commit

### Task 2: Códigos por tipo e domínio `proprio` (produto, família, local)
**Files:** Create `lib/estoque/{driver.ts,proprio-driver.ts,codigos.ts}` · Modify `lib/actions/{produto,familia,local-estoque}.ts` (despacham pelo driver) · Test `scripts/testes/codigos.test.ts`
**Interfaces — Produces:** `proximoCodigo(lojaId, tipoItem) -> string` (90001.. por tipo, sem pular nem repetir), `getDriver(loja) -> { criarProduto, criarLocal, criarFamilia, saldo, entrada, ajuste }`.
- [ ] Teste: código sequencial por tipo, sem colisão em concorrência, recusa duplicado
- [ ] Driver `proprio` (nenhum `omieRequest`; teste com `omieRequest` quebrado)
- [ ] Despacho nas server actions; modo `omie` segue o caminho antigo (teste de regressão)
- [ ] Commit

### Task 3: Criar loja em modo próprio (Estoque)
**Files:** Modify `components/loja/LojaForm.tsx`, `lib/actions/loja.ts`, `app/api/integracao/lojas/route.ts`
- [ ] Seletor "Como a loja controla estoque" (Omie / Estoque próprio / Nenhum); esconde chaves Omie fora do `omie`
- [ ] Semeia: local "Estoque Geral" (padrão), famílias padrão (Bebidas, Cozinha, Insumos, Limpeza), permissões
- [ ] `integracao/lojas` aceita `modo` e devolve `{lojaId, integracaoApiKey, modo}`
- [ ] Commit

### Task 4: Tela de Estoque (design pass obrigatório, padrão do kit `components/ui-kit` e do redesign)
**Files:** Create `app/(app)/estoque/{page.tsx,[codigo]/page.tsx}`, `app/(app)/local-estoque/[id]/page.tsx`
- [ ] **Estoque:** cartões (SKUs, valor em estoque, abaixo do mínimo, zerados/negativos), tabela produto × saldo por local, filtros (família, tipo, local, situação), busca, ordenação
- [ ] **Produto:** saldo por local, CMC, kardex (ledger), mínimo, onde é usado (BOM, depois)
- [ ] **Local:** saldo, valor e itens do local; movimentos recentes
- [ ] **Ações:** Entrada manual, Ajuste, Definir mínimo (modais), tudo via `registrar_movimento`
- [ ] Capturas (claro, escuro, celular) e revisão visual antes de seguir
- [ ] Commit

### Task 5: Vendas ↔ Estoque próprio (baixa na venda)
**Files:** Modify (Estoque) `app/api/integracao/{ordem-producao,saldo,status,produtos,locais-estoque}/route.ts` · (Vendas) `lib/baixaEstoqueServidor.ts`
- [ ] `status` devolve `modo`; `saldo` lê `estoque_saldos` no modo `proprio`
- [ ] `ordem-producao` em modo `proprio`: por item vendido, SAI do local mapeado (`localDaVenda`, mesma precedência de hoje) com `ref = pedidoRef`; produto sem código/duplicado → resultado "pulada" visível, nunca "ok" silencioso
- [ ] Estorno (`venda/estornar`) devolve ao ledger
- [ ] `locais-estoque` POST cria local (modo `proprio`)
- [ ] Commit

### Task 6: Vendas — modo, locais de estoque e textos
**Files:** Create `supabase/migrations/167_modo_estoque.sql`, `lib/modoEstoque.ts`, `components/modules/LocaisEstoqueView.tsx`, `app/api/integracao/locais-estoque-criar/route.ts` · Modify `AdminModule.tsx`, `IntegracaoEstoque.tsx`, `cardapioIntegridade.ts`, `fiscal/cancelar/route.ts`, textos "Omie"
- [ ] `stores.stock_mode` (`omie|proprio|nenhum`, default `omie`); seletor na criação e na edição da loja
- [ ] "Locais de estoque" em Configurações: criar/editar (chama o Estoque) e mapear cada local de consumo (preparo) ao local de estoque de onde ele tira
- [ ] Textos condicionais: nenhum "Omie" para `proprio`/`nenhum`; `nenhum` desliga a baixa e os alertas de código
- [ ] Alerta "produto sem código" e "código repetido" no cardápio
- [ ] NFC-e: `cProd` usa o código do cadastro; caminho Omie só no modo `omie`
- [ ] Portão do Vendas passa; deploy; apps só por `scripts/release-apps.sh` se mexer no app
- [ ] Commit

### Task 7: ODARA BEACH — loja de teste ponta a ponta
- [ ] Criar a loja no Estoque (`proprio`), vincular ao Vendas (loja `e73782c1-fb1a-44a5-904c-e942341d9a94`, `stock_mode='proprio'`)
- [ ] Locais: Estoque Geral, Bar, Cozinha; mapear consumo (bar → Bar, cozinha → Cozinha)
- [ ] **Só nessa loja:** cardápio de teste (bar: cerveja, caipirinha, refrigerante, água; cozinha: porção, prato) com códigos 90xxx, insumos 80xxx, estoque inicial, e ficha técnica semeada para 2 pratos
- [ ] Teste ponta a ponta: vender → baixa no local certo → saldo → estorno → NFC-e em **homologação** com o certificado e o CSC do cofre
- [ ] Commit e relatório do que ficou pronto

## Fases seguintes (cada uma com plano próprio, na ordem)

- **Fase 2 — Produção:** ficha técnica local (unifica `ficha_tecnica_local` e `estrutura_produto_cache`), editor sem Omie, OP que consome insumos (com perda) e entrega o produto pronto em outro local, consumo na venda por receita.
- **Fase 3 — Inventário e transferência próprios:** contagem por local, ajuste pelo ledger, transferência entre locais (par de movimentos), sem CMC do Omie.
- **Fase 4 — Compras:** NF-e de entrada manual e por XML (a coluna `origem` já prevê `manual|xml|sefaz`), efeito no ledger e no CMC; consulta de notas do fornecedor pela SEFAZ (já provada com a Vieras).
- **Fase 5 — Relatórios e fechamento:** relatórios lendo o ledger (valorizado, movimentação, parados), crons para lojas `proprio`, saúde da integração por modo, modo "só Estoque" sem Vendas.

## Self-Review

- Cobertura: modos (tabela), locais de estoque e de consumo (Task 5/6), códigos por tipo (Task 2), sincronia de produto (Task 5/6), ODARA com cardápio de teste só nela (Task 7), NFC-e em homologação (Task 7), "tudo" nas fases 2-5.
- Lacunas assumidas e marcadas: BOM e produção na Fase 2 (Task 7 semeia receitas por SQL só para o teste); NF-e de entrada na Fase 4.
