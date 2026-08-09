# Retry Omie + Auditoria de Completude + Páginas de Detalhe — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Dar retry automático (sem estourar cota da Omie) pros 3 fluxos de
ajuste de estoque que hoje falham silenciosamente sem reenviar; auditar
completude de dado em todos os relatórios (achado real: cancelado some sem
deixar rastro); e criar/enriquecer páginas de detalhe de Ordem de Produção
e Nota Fiscal.

**Architecture:** Replica o padrão de retry já validado em produção pra
conclusão de OP (`conclusao_status`/`tentativas`/`ultima_tentativa_em` +
cron de 10 em 10 min no crontab real do Contabo) nos 3 pontos que chamam
`IncluirAjusteEstoque` sem retry (`inventario.ts`, `movimentacoes.ts`,
`transferencia.ts`). A auditoria de completude segue o mesmo formato da de
2026-08-05 (uma task por relatório/grupo pequeno, sempre com SQL real de
produção). As páginas de detalhe seguem o padrão visual já estabelecido em
`nota-fiscal/[id]/page.tsx` (Server Component + fallback Contabo via
`lib/historico-contabo.ts` + `DetailHeader` + cards client).

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase self-hosted
(Postgres no Contabo), Omie ERP API.

---

## Global Constraints (aplicam a TODAS as tasks)

- **Produção real, sem staging.** Toda verificação usa SQL/API real. Conta
  QA: `claude.qa@ntb-estoque.dev` / `claudeqa123456` contra
  `https://app-estoque.norteparanegocios.com.br`.
- **Bloco 1 grava em produção** (novas colunas + 2 crons novos rodando de
  verdade). Testar cada função de retry manualmente com 1-2 registros de
  erro REAL (existentes hoje em `status = 'Erro'`) antes de considerar a
  task concluída — nunca confiar só em teste sintético.
- **Migrations aplicadas à mão.** Este projeto não tem runner automático
  (`AGENTS.md`, seção "Migrations: aplicadas à mão, sem tracking" — já
  causou bug real 2x nesta sessão por migration esquecida). Toda migration
  nova termina com o comando exato de aplicação via SSH E um passo de
  verificação (`\d tabela`) direto no Postgres de produção — nunca assumir
  que aplicar = arquivo existir no repo.
- **Deploy sempre síncrono**: `ssh -i ~/.ssh/notebook_contabo_key
  root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`, aguardando
  a saída completa (sem `nohup`/background — já corrompeu build nesta
  sessão quando feito errado). Depois de cada deploy que vá ser testado ao
  vivo, confirmar `curl -s -o /dev/null -w "HTTP %{http_code}\n"
  https://app-estoque.norteparanegocios.com.br/login` (esperado `200`).
- **`npx tsc --noEmit`** roda limpo antes de qualquer commit.
- **Fora de escopo**: mudar o filtro de período default da lista de OP
  (decidido explicitamente não mexer — spec `2026-08-09-retry-omie-
  auditoria-detalhes-design.md`, Bloco 2). Não criar task pra isso.
- **Se qualquer task encontrar premissa deste plano errada** (ex.: vínculo
  OP↔inventário não existe do jeito suposto, tabela sem o campo esperado),
  reportar claramente e não prosseguir com suposição — parar e escalar.

---

## Bloco 1 — Retry automático de sync Omie

### Task 1: Migration — colunas de retry em `inventario_items` e `movimentos`

**Contexto:** as duas tabelas já têm `status` (`Iniciado`/`Processando`/
`Concluido`/`Erro`/`Sem CMC`) mas não têm contador de tentativas nem
timestamp da última tentativa — sem isso não dá pra implementar o mesmo
throttle de "Sem CMC" que a OP já usa (1h entre tentativas, teto de 20).

**Files:**
- Create: `supabase/migrations/104_retry_ajustes_estoque.sql`

**Step 1: Escrever a migration**

```sql
-- 104_retry_ajustes_estoque.sql
alter table inventario_items
  add column if not exists tentativas integer not null default 0,
  add column if not exists ultima_tentativa_em timestamptz;

alter table movimentos
  add column if not exists tentativas integer not null default 0,
  add column if not exists ultima_tentativa_em timestamptz;
```

**Step 2: Aplicar via SSH no Postgres de produção**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 \
  "docker exec -i supabase-db psql -U supabase_admin -d postgres" \
  < supabase/migrations/104_retry_ajustes_estoque.sql
```

**Step 3: Verificar que aplicou de verdade**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 \
  "docker exec supabase-db psql -U supabase_admin -d postgres -c '\d inventario_items'"
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 \
  "docker exec supabase-db psql -U supabase_admin -d postgres -c '\d movimentos'"
```

Expected: `tentativas` (`integer`, `not null default 0`) e
`ultima_tentativa_em` (`timestamp with time zone`) aparecem em ambos os
`\d`.

**Step 4: Commit**

```bash
git add supabase/migrations/104_retry_ajustes_estoque.sql
git commit -m "feat: colunas de retry (tentativas/ultima_tentativa_em) em inventario_items e movimentos"
```

---

### Task 2: `inventario.ts` — gravar tentativas/timestamp, zerar em sucesso

**Files:**
- Modify: `lib/actions/inventario.ts` (função `processarItemInventario`,
  bloco de update em sucesso ~linha 340 e o `catch` ~linha 366-379)

**Step 1: No update de sucesso, zerar o contador**

Adicionar ao objeto do `.update()` de sucesso (mesmo bloco que já seta
`status: sucesso ? 'Concluido' : 'Erro'`):

```ts
tentativas: sucesso ? 0 : (item.tentativas ?? 0) + 1,
ultima_tentativa_em: new Date().toISOString(),
```

**Step 2: No `catch`, incrementar também**

O `catch` hoje só grava `status: 'Erro', response: msg`. Adicionar:

```ts
tentativas: (item.tentativas ?? 0) + 1,
ultima_tentativa_em: new Date().toISOString(),
```

(Confirmar que `item` — o registro de `inventario_items` já carregado no
escopo da função — tem `tentativas` disponível; se a query que busca o
item não seleciona essa coluna ainda, adicionar ao `select`.)

**Step 3: `npx tsc --noEmit`**

Expected: sem erros novos.

**Step 4: Commit**

```bash
git add lib/actions/inventario.ts
git commit -m "feat: gravar tentativas/ultima_tentativa_em em processarItemInventario"
```

---

### Task 3: `movimentacoes.ts` e `transferencia.ts` — mesmo tratamento

**Contexto:** as duas gravam na mesma tabela `movimentos`, mesmo padrão de
`.update()` de sucesso/falha do item 2 da investigação.

**Files:**
- Modify: `lib/actions/movimentacoes.ts` (bloco de update ~linha 101-145)
- Modify: `lib/actions/transferencia.ts` (bloco de update ~linha 338-389)

**Step 1: Em cada arquivo, replicar exatamente o padrão da Task 2** —
zerar `tentativas` em sucesso, incrementar + `ultima_tentativa_em` em
falha (tanto no branch de sucesso/falha normal quanto no `catch`).

**Step 2: `npx tsc --noEmit`**

**Step 3: Commit**

```bash
git add lib/actions/movimentacoes.ts lib/actions/transferencia.ts
git commit -m "feat: gravar tentativas/ultima_tentativa_em em movimentacoes e transferencia"
```

---

### Task 4: Função de retry + cron para `inventario_items`

**Contexto:** mirror de `retryOPsPendentes` (`lib/actions/
ordem-producao.ts:861-923`) e `app/api/cron/retry-op-conclusao/route.ts`.
Reusar as mesmas constantes de teto: `SEM_CMC_MAX_TENTATIVAS = 20`,
`SEM_CMC_STALE_HORAS = 1`, `limitePorLoja = 30`. Erro genérico (`'Erro'`)
é reenviado sem teto (mesma filosofia da OP: falha transitória se resolve
sozinha reenviando; falha de dado real — "Sem CMC" — tem teto porque não
vai se resolver sem ação humana no cadastro).

**Files:**
- Modify: `lib/actions/inventario.ts` (adicionar função exportada
  `retryAjustesInventarioPendentes`)
- Create: `app/api/cron/retry-ajustes-inventario/route.ts`

**Step 1: Escrever `retryAjustesInventarioPendentes`**

```ts
const SEM_CMC_MAX_TENTATIVAS = 20
const SEM_CMC_STALE_HORAS = 1

export async function retryAjustesInventarioPendentes(
  lojas: LojaOmie[],
  opts: { limitePorLoja?: number } = {}
): Promise<{ reenviados: number; sucesso: number; falhas: number }> {
  const limitePorLoja = opts.limitePorLoja ?? 30
  const supabase = createServiceClient() // mesmo client usado no resto do arquivo
  let reenviados = 0, sucesso = 0, falhas = 0

  for (const loja of lojas) {
    const staleCutoff = new Date(Date.now() - SEM_CMC_STALE_HORAS * 3600_000).toISOString()

    const { data: itens } = await supabase
      .from('inventario_items')
      .select('id, inventario_id, loja_id, tentativas, status')
      .eq('loja_id', loja.id)
      .or(
        `status.eq.Erro,and(status.eq.Sem CMC,tentativas.lt.${SEM_CMC_MAX_TENTATIVAS},or(ultima_tentativa_em.is.null,ultima_tentativa_em.lt.${staleCutoff}))`
      )
      .limit(limitePorLoja)

    for (const item of itens ?? []) {
      reenviados++
      const ok = await processarItemInventario(item.id, loja.id) // reusa a função já existente
      ok ? sucesso++ : falhas++
    }
  }
  return { reenviados, sucesso, falhas }
}
```

Nota pro implementador: `processarItemInventario` já existe e já faz o
update de status/tentativas (Task 2) — confirmar a assinatura real dela
antes de chamar (pode precisar de mais argumentos, ex. `omie_app_key`
resolvido internamente ou não). Ajustar a chamada acima pro contrato real.

**Step 2: Rota do cron**

```ts
// app/api/cron/retry-ajustes-inventario/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { assertCronAuth } from '@/lib/omie/sync-all'
import { retryAjustesInventarioPendentes } from '@/lib/actions/inventario'
import { getLojasAtivas } from '@/lib/omie/lojas' // confirmar path real do helper de lojas ativas usado por outros crons

export async function GET(request: NextRequest) {
  const authError = assertCronAuth(request)
  if (authError) return authError

  const lojas = await getLojasAtivas()
  const resultado = await retryAjustesInventarioPendentes(lojas, { limitePorLoja: 30 })
  return NextResponse.json(resultado)
}
```

**Step 3: `npx tsc --noEmit`**

**Step 4: Commit**

```bash
git add lib/actions/inventario.ts app/api/cron/retry-ajustes-inventario/route.ts
git commit -m "feat: retry automático de ajuste de inventário pendente"
```

---

### Task 5: Função de retry + cron para `movimentos` (movimentação + transferência)

**Contexto:** mesma lógica da Task 4, mas na tabela `movimentos` (usada
tanto por ajuste manual quanto por transferência). Como as duas já gravam
no mesmo lugar com o mesmo contrato de status, um retry único cobre os
dois fluxos — não precisa saber se a linha veio de `movimentacoes.ts` ou
`transferencia.ts` pra reenviar (o registro tem tudo que precisa:
`codigo_local_estoque`, `id_prod`, `quan`, `tipo`, etc.).

**Files:**
- Create: `lib/actions/retry-movimentos.ts` (não colocar em
  `movimentacoes.ts` nem `transferencia.ts` pra não criar dependência
  cruzada entre os dois — função nova e independente que reprocessa
  qualquer `movimentos` pendente, chamando a mesma lógica de reenvio a
  Omie que já existe)
- Create: `app/api/cron/retry-ajustes-movimentos/route.ts`

**Step 1: Escrever `retryMovimentosPendentes`** — mesmo shape da Task 4,
filtrando `movimentos` por `status IN ('Erro', 'Sem CMC')` com o mesmo
teto/throttle de "Sem CMC". Reenviar chamando a mesma sub-rotina de
`IncluirAjusteEstoque` já usada por `movimentacoes.ts`/`transferencia.ts`
— **investigar durante a implementação se as duas compartilham (ou podem
compartilhar) uma função privada de "reenviar 1 linha de movimentos pra
Omie"**; se não compartilharem hoje, extrair uma função comum
(`reenviarAjusteMovimento(movimentoId)`) pros 3 lugares (o cron novo +os
2 fluxos originais) chamarem, em vez de duplicar a lógica de chamada Omie
uma terceira vez.

**Step 2: Rota do cron** (mesmo padrão da Task 4).

**Step 3: `npx tsc --noEmit`**

**Step 4: Commit**

```bash
git add lib/actions/retry-movimentos.ts app/api/cron/retry-ajustes-movimentos/route.ts
git commit -m "feat: retry automático de ajuste de movimentação/transferência pendente"
```

---

### Task 6: Deploy + ligar os crons no crontab real + teste com dado real

**Contexto:** este projeto roda os crons via `/opt/ntb-estoque/scripts/
sync-cron.sh`, disparado por `crontab -l` real no Contabo a cada 10 min
(**não** `vercel.json`, que é cosmético/inativo desde a migração pro
Contabo). Adicionar as 2 rotas novas nesse script, copiado tanto no repo
quanto no servidor.

**Files:**
- Modify: `scripts/sync-cron.sh` (adicionar as 2 chamadas novas, mesmo
  padrão das existentes: `curl -H "Authorization: Bearer $CRON_SECRET"
  http://127.0.0.1:3002/api/cron/<rota>`)

**Step 1: Adicionar as 2 linhas novas em `scripts/sync-cron.sh`**, no
mesmo formato das existentes (`retry-op-conclusao` já está lá — copiar o
padrão exato pras 2 rotas novas).

**Step 2: Deploy síncrono**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
```

**Step 3: Copiar o script atualizado pro servidor**

```bash
scp -i ~/.ssh/notebook_contabo_key scripts/sync-cron.sh \
  root@185.193.66.240:/opt/ntb-estoque/scripts/sync-cron.sh
```

**Step 4: Confirmar deploy no ar**

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```
Expected: `HTTP 200`.

**Step 5: Teste manual com dado real — ANTES de deixar o cron rodar sozinho**

```bash
# achar 1-2 itens reais em status='Erro' hoje
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 \
  "docker exec supabase-db psql -U supabase_admin -d postgres -c \
  \"select id, loja_id, status, tentativas from inventario_items where status='Erro' limit 2\""

# chamar a rota nova manualmente (CRON_SECRET vem do .env do servidor)
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 \
  "curl -s -H \"Authorization: Bearer \$CRON_SECRET\" http://127.0.0.1:3002/api/cron/retry-ajustes-inventario"

# conferir que tentativas incrementou e ultima_tentativa_em atualizou nos itens testados
```

Repetir o mesmo teste manual pra `retry-ajustes-movimentos` com 1-2
registros reais de `movimentos` em `status='Erro'`.

**Step 6: Só depois do teste manual confirmar que o cron de 10 em 10 min
está rodando sozinho** (aguardar 1 ciclo, checar `ultima_tentativa_em` de
algum item pendente avançou sem intervenção manual).

**Step 7: Commit**

```bash
git add scripts/sync-cron.sh
git commit -m "feat: ligar crons de retry de ajuste (inventário/movimentos) no agendamento real"
```

**⚠️ Esta task grava em produção sem forma fácil de desfazer (cron rodando
automático). Revisão extra rigorosa obrigatória antes de marcar como
concluída — mesmo padrão dos blocos de escrita da reconciliação de
2026-08-08.**

---

## Bloco 3a — Cancelados visíveis no Faturamento

### Task 7: Expor cancelados excluídos na tela de Faturamento

**Contexto:** `lib/omie/faturamento.ts` já exclui cupom/item cancelado da
agregação (`cCupomCancelado === 'S'` / `cItemCancelado === 'S'`), mas
guarda o cupom cancelado no fato bruto (`fat_cupons.cancelado`) sem
mostrar nada na UI. O total faturado NÃO deve mudar — só adicionar
visibilidade do que foi excluído.

**Files:**
- Modify: `app/(app)/relatorio-faturamento/page.tsx`
- Investigar: se existe (ou precisa criar) uma query/RPC que soma
  `fat_cupons` onde `cancelado = true` no período filtrado — se a
  agregação pré-calculada (`faturamento_importado`) não guarda esse dado,
  a contagem/soma de cancelados precisa vir direto de `fat_cupons`
  (Contabo, via `lib/faturamento-frio.ts` ou equivalente) ou de uma nova
  agregação — decidir na implementação com base no que já existe.

**Step 1:** Investigar de onde puxar contagem+valor de cancelados no
período (ver nota acima).

**Step 2:** Adicionar um card/linha visível na tela (ex.: "N cupons
cancelados excluídos — R$ X,XX", não escondido atrás de um toggle
obscuro).

**Step 3:** Validar com SQL direto contra produção que o número bate
(contar/somar `fat_cupons` com `cancelado=true` no mesmo período/loja
mostrado na tela).

**Step 4: `npx tsc --noEmit`**

**Step 5: Commit**

```bash
git add app/\(app\)/relatorio-faturamento/page.tsx
git commit -m "feat: exibir cupons cancelados excluídos no relatório de Faturamento"
```

---

## Bloco 3b — Auditoria de completude de dados (por relatório)

**Formato de cada task deste bloco** (mesmo espírito da auditoria de
2026-08-05, `docs/superpowers/plans/2026-08-04-auditoria-filtros-
relatorios.md`): ler o código do relatório, identificar qualquer lugar
onde dado é excluído/tratado silenciosamente (cancelado, nulo, erro
engolido, status não mapeado) sem sinalizar ao usuário, verificar com SQL
real de produção se isso produz total errado ou só uma omissão visual, e
corrigir se for bug real (célula errada) ou expor/documentar se for
exclusão intencional mas invisível hoje (mesmo padrão da Task 7). Reportar
achados mesmo quando não há nada a corrigir — "auditado, sem achado" é um
resultado válido.

### Task 8: Resumo do dia
**Files:** `app/(app)/resumo/page.tsx` e módulos que ele consome.

### Task 9: Movimentação
**Files:** `app/(app)/relatorio-movimentacao/page.tsx`, RPC
`relatorio_movimentacao_matriz`, `lib/historico-contabo.ts` (parte de
`buscarMovimentosHistoricoBrutos`/`agregarMovimentacaoJS`).

### Task 10: Dashboard de Produção
**Files:** `app/(app)/relatorio-producao/page.tsx`.

### Task 11: Compras
**Files:** `app/(app)/relatorio-compras/page.tsx`, RPCs
`relatorio_compras_*` (migration 077), `lib/relatorio-frio-nf.ts`.

### Task 12: Estoque Valorizado
**Files:** `app/(app)/relatorio-estoque-valorizado/page.tsx`. Já teve bug
real corrigido em 2026-08-05 (migration 091 nunca aplicada) — conferir que
segue correto, e ir além checando completude de dado (não só filtro).

### Task 13: Margem
**Files:** `app/(app)/relatorio-margem/page.tsx`, migration 101
(`margem_snapshot_diario`).

### Task 14: Faturamento × Compras (rota `relatorio-indicadores`)
**Files:** `app/(app)/relatorio-indicadores/page.tsx`,
`lib/omie/financeiro-resumo.ts`.

### Task 15: Auditoria Fiscal
**Files:** `app/(app)/auditoria-fiscal/page.tsx`, RPCs
`relatorio_auditoria_fiscal_*` (migrations 076/078/102).

### Task 16: Pendências de Classificação
**Files:** `app/(app)/pendencias-classificacao/page.tsx`.

Cada task 8-16 segue os mesmos passos: (1) ler código + RPC relevante,
(2) rodar 2-3 queries reais de produção pra achar exclusão silenciosa,
(3) se achar bug: corrigir + validar antes/depois com SQL, (4) se achar
exclusão intencional invisível: expor (mesmo padrão da Task 7) ou
documentar como decisão de produto, (5) `npx tsc --noEmit` se houve
mudança de código, (6) commit (mesmo se o commit for só um comentário
`// auditado 2026-08-09: sem achado` — deixa rastro de que foi checado).

---

## Bloco 4 — Investigação de vínculos (pré-requisito dos Blocos 4/5 de UI)

### Task 17: Mapear vínculos produto↔inventário↔NF↔OP

**Contexto:** a spec marca isso como "investigar na implementação" — não
presumir que dá pra cruzar OP↔inventário só por produto+loja+janela de
tempo até confirmar. Esta task é só investigação/descoberta, sem UI.

**Files:** ler (sem modificar) `lib/actions/ordem-producao.ts`,
`lib/actions/inventario.ts`, `lib/actions/nota-fiscal.ts`, e os schemas
reais de `ordens_producao`, `inventario_items`, `notas_fiscais`,
`nota_fiscal_items`, `movimentos` (via `\d` no Contabo).

**Perguntas a responder, com evidência real (não suposição):**
1. Existe alguma chave direta (não só produto+loja+data aproximada) entre
   um item de inventário e a OP relacionada? (ex.: via `id_ajuste`/
   `cod_int_ajuste` batendo com algo gravado na OP, ou é mesmo só
   correlação por produto/loja/janela de tempo?)
2. Existe alguma relação direta entre `ordens_producao` e `notas_fiscais`
   (FK, campo textual, ou é preciso cruzar por produto de novo)?
3. `movimentos` tem `id_prod`/`codigo_local_estoque` — dá pra cruzar
   direto com `notas_fiscais`/`nota_fiscal_items` (quais campos exatos) e
   com `ordens_producao` (via produto)?

**Output:** um resumo curto (pode ser só no relatório da task, não precisa
virar doc separado) descrevendo a query exata de cruzamento que cada
task de UI (18 e 19) deve usar. Se a resposta for "só dá pra cruzar por
produto+loja+janela de tempo, sem FK direta", registrar isso claramente —
é uma limitação real da UI resultante, não um bug a esconder.

**Nenhum commit de código necessário nesta task** (é investigação pura) —
só o relatório.

---

### Task 18: Página de detalhe de Ordem de Produção (nova)

**Contexto:** hoje não existe `ordem-producao/[id]/page.tsx` — só linha
expandida na lista. Seguir o padrão visual de `nota-fiscal/[id]/page.tsx`
(Server Component async → resolve permissão → busca no Supabase quente
com fallback pra `complementarOrdensProducao` do Contabo via
`lib/historico-contabo.ts` → `DetailHeader` com breadcrumb+meta → seções
como Client Components em cards `rounded-lg border border-border
bg-surface p-3/p-4`).

**Files:**
- Create: `app/(app)/ordem-producao/[id]/page.tsx`
- Create: `components/ordem-producao/InventariosRelacionadosOP.tsx`
- Create: `components/ordem-producao/HistoricoSyncOP.tsx`
- Create: `components/ordem-producao/HistoricoEdicoesOP.tsx` (lê
  `audit_log` filtrado por `entidade='ordem_producao'` e
  `entidade_id=<id>`, mesmo schema confirmado na investigação)
- Modify: lista de OP (`components/ordem-producao/OrdemProducaoRow.tsx`
  e/ou `OrdemProducaoLista.tsx`) — adicionar link/navegação pra nova
  página de detalhe

**Step 1:** Página base (dados que já existem hoje na linha expandida:
produto, quantidade, ingredientes, validade, status) — seguir o padrão
Server Component + `DetailHeader` da NF.

**Step 2:** Seção "Inventários relacionados" — usar a query de
cruzamento confirmada na Task 17.

**Step 3:** Seção "Nota fiscal vinculada" — idem, usando a query
confirmada na Task 17 (ou documentar que não existe vínculo direto, se
foi essa a conclusão).

**Step 4:** Seção "Histórico de sync com a Omie" — expor
`conclusao_status`/`conclusao_tentativas`/`conclusao_erro_msg`/
`conclusao_ultima_tentativa_em` (já existem no banco).

**Step 5:** Seção "Histórico de edições" — via `audit_log`.

**Step 6:** Adicionar navegação da lista pra essa página nova.

**Step 7:** QA manual com a conta QA contra produção — abrir o detalhe de
2-3 OPs reais (uma com histórico de erro de sync, se existir alguma) e
conferir visualmente que as 4 seções mostram dado real e correto.

**Step 8: `npx tsc --noEmit`**

**Step 9: Commit**

```bash
git add app/\(app\)/ordem-producao/\[id\]/page.tsx components/ordem-producao/
git commit -m "feat: página de detalhe de Ordem de Produção"
```

---

### Task 19: Enriquecer página de detalhe de Nota Fiscal

**Files:**
- Modify: `app/(app)/nota-fiscal/[id]/page.tsx`
- Create: `components/nota-fiscal/OPsRelacionadasNF.tsx`
- Create: `components/nota-fiscal/MovimentacoesGeradasNF.tsx`
- Create: `components/nota-fiscal/HistoricoStatusNF.tsx` (via
  `audit_log`/`webhooks`, usando a mesma query confirmada — se aplicável —
  na Task 17, ou uma nova investigação pontual se a NF não foi coberta lá)

**Step 1:** Seção "OPs relacionadas" — mesma query de cruzamento da Task
17/18, direção oposta (produto da NF → OPs).

**Step 2:** Seção "Movimentações de estoque geradas" — `movimentos`
filtrado pelo(s) produto(s)/janela de tempo da NF (confirmar critério
exato na implementação).

**Step 3:** Seção "Histórico de status/manifestação" — linha do tempo via
`audit_log`/`webhooks`.

**Step 4:** QA manual com conta QA contra produção, 2-3 NFs reais.

**Step 5: `npx tsc --noEmit`**

**Step 6: Commit**

```bash
git add app/\(app\)/nota-fiscal/\[id\]/page.tsx components/nota-fiscal/
git commit -m "feat: enriquecer detalhe de Nota Fiscal (OPs, movimentações, histórico)"
```

---

## Ordem de execução

1. Tasks 1-6 (Bloco 1, retry) — maior risco técnico, fazer com calma e
   revisão extra rigorosa antes de considerar concluído.
2. Task 7 (cancelados no Faturamento) — pequeno, isolado.
3. Tasks 8-16 (auditoria de completude) — podem ser feitas em qualquer
   ordem entre si.
4. Task 17 (investigação de vínculos) — antes das Tasks 18-19.
5. Tasks 18-19 (páginas de detalhe) — por último, aproveitando o que os
   blocos anteriores expuserem sobre os vínculos de dado.

---

## Execução

Oferecida via `superpowers:subagent-driven-development` nesta mesma
sessão. **O Bloco 1 (Tasks 1-6) grava em produção com colunas novas e 2
crons automáticos rodando de verdade, sem forma fácil de desfazer — essa
parte específica precisa de revisão extra rigorosa (mesmo padrão da
reconciliação de 2026-08-08: testar com 1-2 registros reais antes de
considerar concluído, nunca aceitar só o relato do implementador sem
conferir com SQL direto em produção).**
