# Sync Automático + Features NTB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Passos com checkbox (`- [ ]`).

**Goal:** Tornar o sync com o Omie 100% automático (sem clicar) e adicionar features aprovadas (validade vencendo, painel de erros de sync, busca global, exportar CSV, histórico de impressão), tudo escopado por permissão/loja do usuário (não só admin), sem alterar os fluxos existentes.

**Architecture:** Sync automático em 2 camadas: webhook do Omie (tempo real, já implementado) + cron frequente via GitHub Actions (grátis, contorna o limite de 1x/dia do Vercel free). Features são telas/rotas NOVAS e aditivas; nenhuma toca nota fiscal, contagem ou etiqueta. Toda leitura usa `getCurrentLojaId()` + `requirePermissao()`, então respeita o nível do usuário automaticamente.

**Tech Stack:** Next.js 16, Supabase, GitHub Actions, design system existente (`components/ui-kit/*`), lucide-react.

**Fora de escopo (bloqueado por dados):** "Estoque abaixo do mínimo" — `estoque_minimo` vem 0 do Omie e `posicao_estoques` está vazia (o sync de posição não persiste saldos). Reavaliar quando houver saldo/mínimo reais. WhatsApp e sugestão de transferência: descartados pelo usuário.

---

## FASE 1 — Sync automático sempre ativo (prioridade)

### Task 1: Cron frequente via GitHub Actions

**Files:**
- Create: `.github/workflows/sync-omie.yml`
- Verify: `lib/omie/sync-all.ts` (assertCronAuth) e rotas `app/api/cron/*`

- [ ] **Step 1: Confirmar como as rotas de cron autenticam** — ler `lib/omie/sync-all.ts::assertCronAuth` e uma rota `app/api/cron/sync-nfs/route.ts` para ver o header esperado (provável `Authorization: Bearer ${CRON_SECRET}`). Anotar o header exato.

- [ ] **Step 2: Criar o workflow** `.github/workflows/sync-omie.yml` que chama as rotas com o secret. Frequências: NF e OP a cada 10 min; locais a cada 30 min; produtos a cada 60 min (mudam pouco).

```yaml
name: Sync Omie
on:
  schedule:
    - cron: '*/10 * * * *'   # NF + OP a cada 10 min
    - cron: '15,45 * * * *'  # locais 2x/h
    - cron: '5 * * * *'      # produtos 1x/h
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Disparar sincronizacoes
        env:
          BASE: https://ntb-estoque.vercel.app
          SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          min=$(date -u +%M)
          hit() { curl -s -m 60 -o /dev/null -w "%{http_code} $1\n" -H "Authorization: Bearer $SECRET" "$BASE$1" || true; }
          # sempre que rodar: NF e OP
          hit /api/cron/sync-nfs
          hit /api/cron/sync-ops
          # locais nos minutos 15 e 45
          if [ "$min" = "15" ] || [ "$min" = "45" ]; then hit /api/cron/sync-locais; fi
          # produtos no minuto 05
          if [ "$min" = "05" ]; then hit /api/cron/sync-produtos; fi
```

- [ ] **Step 3: Documentar o secret** — Criar `docs/sync-automatico.md` explicando: adicionar `CRON_SECRET` em GitHub repo → Settings → Secrets and variables → Actions (mesmo valor do `.env` do Vercel), e que o webhook do Omie deve estar cadastrado nas 6 lojas (URL na tela de Lojas). NÃO commitar o valor do secret.

- [ ] **Step 4: Commit** (o workflow só roda após push e secret configurado)

```bash
git add .github/workflows/sync-omie.yml docs/sync-automatico.md
git commit -m "feat(sync): cron frequente via GitHub Actions para sync automatico continuo"
```

### Task 2: Produtos no webhook + sync incremental NF/OP

**Files:**
- Modify: `app/api/webhook/route.ts`

- [ ] **Step 1: Tratar tópico de produto no webhook** — adicionar branch para `topic.startsWith('Produto.') && topic !== 'Produto.Excluido'` chamando um `fetchProduto(loja, codigo)` (criar em `lib/omie/produto.ts` se não existir um fetch unitário; senão disparar `syncProdutos` com guarda de concorrência). Manter os IGNORED_TOPICS de estoque. Erros não quebram o 200.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add app/api/webhook/route.ts lib/omie/produto.ts
git commit -m "feat(webhook): processa eventos de Produto em tempo real"
```

### Task 3: Reposicionar o botão "Sincronizar" como "forçar agora"

**Files:**
- Modify: `components/SyncButton.tsx`

- [ ] **Step 1:** Trocar o label padrão para "Atualizar agora" e adicionar `title="O sistema sincroniza sozinho; use para forçar"`. Comportamento idêntico. (Não remover — é o fallback manual.)

- [ ] **Step 2: Commit**

```bash
git add components/SyncButton.tsx
git commit -m "feat(ui): botao de sync vira 'Atualizar agora' (automatico ja roda em background)"
```

---

## FASE 2 — Validade vencendo

### Task 4: Tela "Validade"

**Files:**
- Create: `app/(app)/validade/page.tsx`
- Modify: `components/shell/NavItems.ts` (item de menu, grupo Operação)
- Modify: `components/shell/MobileNav.tsx` se necessário (bottom bar fica igual)

- [ ] **Step 1: Item de menu** — adicionar em `NavItems.ts`: `{ href: '/validade', label: 'Validade', icon: CalendarClock, group: 'Operação' }` (importar `CalendarClock` de lucide).

- [ ] **Step 2: Página** — server component escopado por `getCurrentLojaId()` + `requirePermissao(lojaId, 'Ordens de Producao')`. Lê searchParams `dias` (default 7; chips 3/7/15/30). Query: `ordens_producao` da loja com `validade` não nula e `validade <= hoje+dias`, ordenado por validade asc. Resolve descrição do produto via `produtos` (join por `identificacao_n_cod_produto`). Mostra em `DataTable`: Validade (com destaque vermelho se já vencida, âmbar se <=3 dias), Produto, OP, Qtd. Cabeçalho com `PageHeader` (ícone CalendarClock) + chips de período. Vazio → `EmptyState`.

```tsx
// regra de cor por dias restantes
function tom(validade: string): string {
  const hoje = new Date(); hoje.setHours(0,0,0,0)
  const v = new Date(validade + 'T00:00:00')
  const dias = Math.round((v.getTime() - hoje.getTime()) / 86400000)
  if (dias < 0) return '#ef4444'      // vencido
  if (dias <= 3) return '#f59e0b'     // critico
  return '#64748b'                    // ok
}
```

- [ ] **Step 3:** Adicionar um atalho na home (card "Validade") apontando para `/validade` — opcional, dentro de "Ações rápidas".

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add "app/(app)/validade" components/shell/NavItems.ts "app/(app)/home/page.tsx"
git commit -m "feat(validade): tela de produtos vencendo por periodo, escopada por loja"
```

---

## FASE 3 — Painel de erros de sync

### Task 5: Tela "Saúde da integração"

**Files:**
- Create: `app/(app)/sync-status/page.tsx`
- Modify: `components/shell/NavItems.ts` (grupo Cadastros ou Administração)
- Create: `components/sync/ReprocessarErro.tsx` (client, botão que dispara reprocesso)
- Possível: `lib/actions/sync-status.ts`

- [ ] **Step 1: Página** — escopada por `getCurrentLojaId()`; admin vê todas as lojas vinculadas, não-admin só a sua (mesmo padrão do layout). Lê `integration_attempts` com `error = true` da(s) loja(s), recentes primeiro, com filtro de período/model. Mostra: data, model, loja, code, trecho do erro (expansível, reusar `LogDetalhe`), e botão "Reprocessar" quando aplicável (re-disparar o sync daquele model).

- [ ] **Step 2: Resumo no topo** — cards: "X erros nas últimas 24h", "última sync OK em ...". Usa os campos `*_status`/`*_ultima_atualizacao` da loja.

- [ ] **Step 3: Item de menu** + build + commit

```bash
npm run build
git add "app/(app)/sync-status" components/shell/NavItems.ts components/sync lib/actions/sync-status.ts
git commit -m "feat(sync-status): painel de saude/erros da integracao Omie, escopado por loja"
```

---

## FASE 4 — Busca global

### Task 6: Busca global (atalho /)

**Files:**
- Create: `components/shell/BuscaGlobal.tsx` (client, dialog Base UI)
- Create: `lib/actions/busca-global.ts`
- Modify: `components/shell/AppShell.tsx` (montar o dialog + atalho de teclado `/`)

- [ ] **Step 1: Action** `buscaGlobal(termo)` — escopada por `getCurrentLojaId()`/permissão; busca em paralelo (limit 5 cada): produtos (codigo/descricao ilike, com `escapeIlike`), notas (c_numero_nfe/fornecedor), OPs (num_ordem/produto). Retorna grupos com href.

- [ ] **Step 2: Dialog** — abre com `/` (ou botão na topbar), input com debounce 250ms, lista agrupada (Produtos / Notas / OPs) com navegação por link. Fecha ao navegar. Usa tokens do design system.

- [ ] **Step 3: Atalho** — listener global em AppShell: tecla `/` (fora de input) abre; `Esc` fecha.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add components/shell/BuscaGlobal.tsx lib/actions/busca-global.ts components/shell/AppShell.tsx
git commit -m "feat(busca): busca global com atalho / (produtos, notas, OPs), escopada por loja"
```

---

## FASE 5 — Exportar listagens em CSV

### Task 7: Exportar CSV

**Files:**
- Create: `lib/csv.ts` (helper `toCsv(rows, colunas)` + `csvResponse`)
- Create: rotas `app/(app)/{nota-fiscal,ordem-producao,produto}/export/route.ts`
- Modify: as 3 páginas (botão "Exportar CSV" no header, preservando os filtros atuais via querystring)

- [ ] **Step 1: Helper CSV** — `toCsv` que escapa aspas/vírgula/quebra de linha e gera string com BOM (`﻿`) para Excel pt-BR abrir com acentos. `csvResponse(nome, csv)` devolve `text/csv` com `Content-Disposition: attachment`.

- [ ] **Step 2: Rotas de export** — cada uma repete a query da listagem correspondente (mesmos filtros lidos do searchParams), SEM paginação (ou paginando internamente), e retorna CSV. Escopadas por permissão/loja.

- [ ] **Step 3: Botão** nas 3 páginas — `<a href={"/nota-fiscal/export?"+params}>` com `btnClass('outline')` e ícone Download, preservando os filtros ativos.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add lib/csv.ts "app/(app)/nota-fiscal/export" "app/(app)/ordem-producao/export" "app/(app)/produto/export" "app/(app)/nota-fiscal/page.tsx" "app/(app)/ordem-producao/page.tsx" "app/(app)/produto/page.tsx"
git commit -m "feat(export): exportar Notas/OPs/Produtos em CSV preservando filtros"
```

---

## FASE 6 — Histórico de impressão de etiquetas

### Task 8: Registrar e listar impressões

**Files:**
- Create: `supabase/migrations/004_impressao_etiquetas.sql`
- Modify: `app/(app)/nota-fiscal/[id]/imprimir/route.ts` e `app/(app)/ordem-producao/[id]/imprimir/route.ts` (registrar a impressão)
- Create: `app/(app)/impressoes/page.tsx`
- Modify: `components/shell/NavItems.ts`

- [ ] **Step 1: Migration** — tabela `impressao_etiquetas` (id, loja_id, origem 'NF'|'OP', referencia_id, qtd_etiquetas, itens jsonb null, user_id, created_at) + RLS por loja (espelhar o padrão das outras tabelas do schema). Aplicar via o fluxo de migração usado no projeto (script Node que roda o SQL; ver como as migrations 001-003 foram aplicadas).

- [ ] **Step 2: Registrar** — nas duas rotas de impressão, após gerar o PDF com sucesso, inserir uma linha em `impressao_etiquetas` (origem, referencia_id, qtd = nº de etiquetas, user_id via auth). Não bloquear o PDF se o insert falhar (try/catch).

- [ ] **Step 3: Tela** `/impressoes` — escopada por loja/permissão; lista as impressões recentes (data, origem, referência com link, qtd, quem imprimiu) em `DataTable` com botão "Reimprimir" (reabre a rota de impressão correspondente). Item de menu em Operação ou Cadastros.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add supabase/migrations/004_impressao_etiquetas.sql "app/(app)/impressoes" "app/(app)/nota-fiscal/[id]/imprimir/route.ts" "app/(app)/ordem-producao/[id]/imprimir/route.ts" components/shell/NavItems.ts
git commit -m "feat(impressoes): historico de impressao de etiquetas com reimpressao"
```

---

## Self-Review

**Cobertura do que o usuário aprovou:** sync automático (T1-T3), validade (T4), painel de erros (T5), busca global (T6), exportar CSV (T7), histórico de impressão (T8). Estoque mínimo documentado como bloqueado por dados. WhatsApp/sugestão descartados.

**Nível de usuário (reforçado pelo usuário):** toda página nova usa `getCurrentLojaId()` + `requirePermissao()`; painel/erros e dados escopados às lojas vinculadas do usuário (mesmo padrão já aplicado no layout/home). Não é "só admin".

**Não afeta o fluxo atual:** todas as features são rotas/itens novos; as únicas modificações em arquivos existentes são aditivas (item de menu, botão de export, registro de impressão em try/catch, branch de produto no webhook). Nenhuma muda nota fiscal/contagem/etiqueta no que já funciona.

**Restrições:** sem travessão; acentuação correta; status do banco sem acento; nunca acionar escrita no Omie em teste; CRON_SECRET nunca commitado.

**Tipos/consistência:** `escapeIlike` (já existe em lib/utils-busca.ts) reusado na busca global e export; `toCsv`/`csvResponse` (T7) usados pelas 3 rotas de export; tabela `impressao_etiquetas` (T8) criada antes de ser usada pelas rotas.

**Ordem de execução:** Fase 1 (sync, a dor real) → 2 (validade) → 3 (erros) → 4 (busca) → 5 (export) → 6 (impressão).
